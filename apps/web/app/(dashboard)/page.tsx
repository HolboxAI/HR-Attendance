import {
  BellOff, CalendarClock, CalendarDays, CircleUserRound, ClipboardList,
  Download, LayoutGrid, ScanFace, UserCheck, Wallet,
} from 'lucide-react';

import { DashboardTile } from '@/components/DashboardTile';
import { MyMonth } from '@/components/MyMonth';
import {
  getBoard, getCorrectionsPending, getEnrolments, getMyMonth, getPending, getRejected,
} from '@/lib/api';
import { proxy } from '@/lib/format';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The overview every admin lands on - what the board used to be before it
 * moved to /board for the full table. This page answers "what needs me
 * today", the board answers "show me everyone".
 *
 * A plain employee has no overview to see - same rule as the old board page -
 * so they get their own month instead of a grid of admin shortcuts.
 */
export default async function DashboardPage() {
  const me = await currentIdentity();
  const result = await getBoard();

  if (!result.ok && result.reason === 'forbidden') {
    const now = new Date();
    const mine = await getMyMonth(now.getUTCFullYear(), now.getUTCMonth() + 1);
    return <MyMonth data={mine} name={me?.full_name ?? null} />;
  }

  if (!result.ok) {
    return (
      <div className="bx-card p-6">
        <h2 className="text-lg font-semibold">
          {result.reason === 'unreachable' ? "The API isn't running" : 'Could not load the dashboard'}
        </h2>
        {result.reason === 'unreachable' && (
          <>
            <p className="mt-2 max-w-prose text-sm text-ink-2">Start it and this page will fill in:</p>
            <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-3 text-xs text-ink-2">
cd apps/api && .venv/bin/uvicorn app.main:app --reload</pre>
          </>
        )}
      </div>
    );
  }

  const board = result.data;
  const [pendingLeave, pendingCorrections, enrolments, rejected] = await Promise.all([
    getPending(), getCorrectionsPending(), getEnrolments(), getRejected(),
  ]);
  const isHr = me?.is_admin ?? false;

  const year = new Date().getUTCFullYear();
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Good {timeOfDay()}, {(me?.full_name ?? '').split(' ')[0] || 'there'}
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          {new Date(`${board.shift_date}T00:00:00Z`).toLocaleDateString('en-IN', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
          })}
          {' · '}Recomputed from raw punches on every load.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Today's attendance
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <DashboardTile label="In the office" icon={UserCheck} href="/board" value={board.summary.currently_in} sub={`of ${board.summary.headcount}`} tone="accent" />
          <DashboardTile label="Present" icon={CircleUserRound} href="/board" value={board.summary.present} sub="full days" tone="present" />
          <DashboardTile label="Late" icon={CalendarClock} href="/board" value={board.summary.late} sub="past grace" tone="late" />
          <DashboardTile label="Absent" icon={BellOff} href="/board" value={board.summary.absent} sub="no punches" tone="absent" />
          <DashboardTile label="On leave" icon={CalendarDays} href="/leave" value={board.summary.on_leave} sub="approved" tone="half" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Waiting on you
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <DashboardTile
            label="Leave requests" icon={ClipboardList} href="/leave"
            value={pendingLeave.ok ? pendingLeave.data.length : '—'} sub="pending" tone="late"
          />
          <DashboardTile
            label="Corrections" icon={ClipboardList} href="/corrections"
            value={pendingCorrections.ok ? pendingCorrections.data.length : '—'} sub="pending" tone="late"
          />
          <DashboardTile
            label="Needs attention" icon={ClipboardList} href="/board"
            value={board.summary.exceptions} sub="exceptions today" tone="late"
          />
          <DashboardTile
            label="Refused punches" icon={ClipboardList} href="/board"
            value={rejected?.length ?? 0} sub="last 7 days" tone="absent"
          />
        </div>
      </section>

      {isHr && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Manage
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <DashboardTile
              label="Enrolment" icon={ScanFace} href="/enrolment"
              value={enrolments.ok ? enrolments.data.summary.missing : '—'} sub="missing a photo" tone="neutral"
            />
            <DashboardTile label="Leave policy" icon={CalendarDays} href="/leave/policy" sub="quotas, accrual, holidays" tone="neutral" />
            <DashboardTile label="Check in" icon={UserCheck} href="/checkin" sub="camera + face match, from this browser" tone="accent" />
            <DashboardTile
              label={`Export ${monthLabel}`} icon={Download}
              href={proxy(`/api/v1/admin/export/month.csv?year=${year}&month=${new Date().getUTCMonth() + 1}`)}
              sub="attendance register, one click" tone="neutral"
            />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          On the roadmap
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <DashboardTile label="Missing punch-out nudge" icon={LayoutGrid} soon />
          <DashboardTile label="Push notifications" icon={LayoutGrid} soon />
          <DashboardTile label="Payroll" icon={Wallet} soon />
        </div>
      </section>
    </div>
  );
}

function timeOfDay() {
  const h = new Date().getUTCHours() + 5.5; // IST, roughly enough for a greeting
  const hour = h >= 24 ? h - 24 : h;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
