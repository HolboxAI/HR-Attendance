import Link from 'next/link';
import {
  AlertTriangle, BellOff, CalendarClock, CalendarDays, CalendarRange,
  CircleUserRound, ClipboardList, Download, ScanFace, Smartphone, UserCheck,
} from 'lucide-react';

import { AttendancePulse } from '@/components/AttendancePulse';
import { ErrorState } from '@/components/ErrorState';
import { MetricTile } from '@/components/MetricTile';
import { MyMonth } from '@/components/MyMonth';
import {
  getBoard, getCorrectionsPending, getEnrolments, getHolidays, getMyMonth,
  getPending, getRejected, hhmm,
} from '@/lib/api';
import { capabilitiesFor } from '@/lib/capabilities';
import { proxy } from '@/lib/format';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The landing page, composed per role from real capability rather than role
 * cosmetics. Super admin and HR admin see the same operational dashboard
 * because their API access is identical today (frontend PRD §1.2) - honest,
 * not a gap. Managers get the same shape scoped to their reports by the API
 * itself. Employees get their own month: they have no company overview to
 * see, and a wall of admin shortcuts that all 403 would be worse than useful.
 */
export default async function DashboardPage() {
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  const result = await getBoard();

  // Not an approver: their own attendance IS their overview.
  if (!result.ok && result.reason === 'forbidden') {
    const now = new Date();
    const mine = await getMyMonth(now.getUTCFullYear(), now.getUTCMonth() + 1);
    return (
      <div className="space-y-8">
        <MyMonth data={mine} name={me?.full_name ?? null} />
        <section className="grid gap-3 sm:grid-cols-3">
          <Link href="/leave" className="bx-card block px-4 py-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CalendarClock className="size-4 text-accent" aria-hidden />
            <div className="mt-2 text-sm font-medium">Apply for leave</div>
            <div className="text-xs text-ink-3">Balances, requests, cancellations</div>
          </Link>
          <Link href="/corrections" className="bx-card block px-4 py-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <ClipboardList className="size-4 text-accent" aria-hidden />
            <div className="mt-2 text-sm font-medium">Fix a broken day</div>
            <div className="text-xs text-ink-3">Request a correction for a flagged day</div>
          </Link>
          <Link href="/notifications" className="bx-card block px-4 py-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <BellOff className="size-4 text-accent" aria-hidden />
            <div className="mt-2 text-sm font-medium">Notifications</div>
            <div className="text-xs text-ink-3">Decisions on your leave and corrections</div>
          </Link>
        </section>
      </div>
    );
  }

  if (!result.ok) return <ErrorState reason={result.reason} />;

  const board = result.data;
  const year = new Date().getUTCFullYear();
  const [pendingLeave, pendingCorrections, enrolments, rejected, holidays] =
    await Promise.all([
      getPending(),
      caps.canDecideCorrections ? getCorrectionsPending() : Promise.resolve(null),
      caps.canManageEnrolment ? getEnrolments() : Promise.resolve(null),
      getRejected(),
      getHolidays(year),
    ]);

  const exceptions = board.rows.filter((r) => r.has_exception);
  const unconfirmedHolidays = (holidays ?? []).filter((h) => !h.is_confirmed);
  const monthNum = new Date().getUTCMonth() + 1;
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-10">
      <div className="bx-rise">
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

      <section className="space-y-3" aria-label="Today's workforce">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Workforce now
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <MetricTile index={0} label="In the office" icon="userCheck" href="/board" value={board.summary.currently_in} sub={`of ${board.summary.headcount}`} tone="accent" />
          <MetricTile index={1} label="Present" icon="person" href="/board" value={board.summary.present} sub="full days" tone="present" />
          <MetricTile index={2} label="Late" icon="clock" href="/board" value={board.summary.late} sub="past grace" tone="late" />
          <MetricTile index={3} label="Absent" icon="bellOff" href="/board" value={board.summary.absent} sub="no punches" tone="absent" />
          <MetricTile index={4} label="On leave" icon="calendar" href="/leave" value={board.summary.on_leave} sub="approved" tone="half" />
        </div>
      </section>

      <section className="space-y-3" aria-label="Today's check-ins over time">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Attendance pulse · today
        </h2>
        <AttendancePulse rows={board.rows} />
      </section>

      <section className="space-y-3" aria-label="Waiting on you">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Waiting on you
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricTile
            index={0} label="Leave requests" icon="clipboard" href="/leave"
            value={pendingLeave.ok ? pendingLeave.data.length : '—'} sub="pending decision" tone="late"
          />
          {caps.canDecideCorrections && (
            <MetricTile
              index={1} label="Corrections" icon="clipboard" href="/corrections"
              value={pendingCorrections?.ok ? pendingCorrections.data.length : '—'} sub="pending decision" tone="late"
            />
          )}
          <MetricTile
            index={2} label="Needs attention" icon="alert" href="/board"
            value={board.summary.exceptions} sub="exceptions today" tone="late"
          />
          <MetricTile
            index={3} label="Refused punches" icon="range" href="/board#refused"
            value={rejected?.length ?? 0} sub="last 7 days" tone="absent"
          />
        </div>
      </section>

      {(exceptions.length > 0 || unconfirmedHolidays.length > 0) && (
        <section className="space-y-3" aria-label="Attention">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-st-late">
            Attention
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {exceptions.length > 0 && (
              <div className="bx-card border-st-late/40 p-4">
                <h3 className="text-sm font-semibold">
                  <AlertTriangle className="mr-1.5 inline size-4 text-st-late" aria-hidden />
                  Days that can&rsquo;t be counted yet
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {exceptions.slice(0, 5).map((r) => (
                    <li key={r.employee_code} className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/people/${r.employee_code}`} className="font-medium hover:text-accent">
                        {r.full_name}
                      </Link>
                      <span className="text-ink-3">in at {hhmm(r.first_in)}</span>
                      <span className="text-st-late">{r.exception_note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {unconfirmedHolidays.length > 0 && (
              <div className="bx-card border-st-late/40 p-4">
                <h3 className="text-sm font-semibold">
                  <AlertTriangle className="mr-1.5 inline size-4 text-st-late" aria-hidden />
                  {unconfirmedHolidays.length} holiday date{unconfirmedHolidays.length === 1 ? '' : 's'} to check
                </h3>
                <p className="mt-1 text-xs text-ink-2">
                  Lunar-calendar festivals seeded from estimates. A wrong date marks the whole
                  company off on the wrong day - confirm them against the state notification.
                </p>
                <Link href="/leave/policy" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
                  Review the holiday calendar →
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {caps.canManageEnrolment && (
        <section className="space-y-3" aria-label="Manage">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Manage
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <MetricTile
              index={0} label="Enrolment" icon="scanFace" href="/enrolment"
              value={enrolments ? enrolments.summary.missing : '—'} sub="missing a photo" tone="neutral"
            />
            <MetricTile
              index={1} label="Devices" icon="phone" href="/devices"
              value="→" sub="bound handsets" tone="neutral"
            />
            <MetricTile
              index={2} label="Leave policy" icon="calendar" href="/leave/policy"
              value="→" sub="quotas, accrual, holidays" tone="neutral"
            />
            <a
              href={proxy(`/api/v1/admin/export/month.csv?year=${year}&month=${monthNum}`)}
              className="bx-card bx-rise-i block px-4 py-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
              style={{ ['--bx-i' as string]: 3 }}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                <Download className="size-4" aria-hidden />
              </span>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-3">
                Export {monthLabel}
              </div>
              <div className="mt-0.5 text-sm font-medium text-ink">Attendance register · CSV</div>
              <div className="mt-0.5 text-xs text-ink-3">Recomputed at download time</div>
            </a>
          </div>
        </section>
      )}
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
