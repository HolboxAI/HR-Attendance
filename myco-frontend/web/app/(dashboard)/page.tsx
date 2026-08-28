import Link from 'next/link';
import {
  AlertTriangle, BellOff, CalendarClock, CalendarDays, CalendarRange,
  CircleUserRound, ClipboardList, Download, ScanFace, Smartphone, UserCheck,
} from 'lucide-react';

import { AttendancePulse } from '@/components/AttendancePulse';
import { ErrorState } from '@/components/ErrorState';
import { MetricTile } from '@/components/MetricTile';
import { MyMonth } from '@/components/MyMonth';
import { KineticTicker } from '@/components/ui/kinetic-ticker';
import { GlowCard } from '@/components/ui/spotlight-card';
import {
  getBoard, getCorrectionsPending, getEnrolments, getHolidays, getMyMonth,
  getPending, getRejected, hhmm,
} from '@/lib/api';
import { capabilitiesFor } from '@/lib/capabilities';
import { istYearMonth, proxy } from '@/lib/format';
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
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  const result = await getBoard();

  // Not an approver: their own attendance IS their overview.
  if (!result.ok && result.reason === 'forbidden') {
    // Month defaults come from the ORG's clock, not UTC - on the 1st before
    // 05:30 IST, getUTCMonth() still says last month.
    const ist = istYearMonth();
    const { y, m } = await searchParams;
    const year = Number(y) || ist.year;
    const month = Number(m) || ist.month;
    const mine = await getMyMonth(year, month);
    return (
      <div className="space-y-8 fade-in-up">
        <MyMonth data={mine} name={me?.full_name ?? null} year={year} month={month} />
        <section className="grid gap-4 sm:grid-cols-3">
          <Link href="/leave" className="glass-panel glass-panel-hover block rounded-2xl p-5 group">
            <div className="size-10 rounded-xl bg-surface-2 border border-line flex items-center justify-center text-ink-2 mb-3 group-hover:scale-105 transition-transform">
              <CalendarClock className="size-5" aria-hidden />
            </div>
            <div className="font-display text-base font-bold text-ink">Apply for leave</div>
            <div className="mt-1 text-xs text-ink-3">Check remaining balances, apply and track requests</div>
          </Link>
          <Link href="/corrections" className="glass-panel glass-panel-hover block rounded-2xl p-5 group">
            <div className="size-10 rounded-xl bg-surface-2 border border-line flex items-center justify-center text-ink-2 mb-3 group-hover:scale-105 transition-transform">
              <ClipboardList className="size-5" aria-hidden />
            </div>
            <div className="font-display text-base font-bold text-ink">Punch corrections</div>
            <div className="mt-1 text-xs text-ink-3">Submit time adjustments for any flagged attendance day</div>
          </Link>
          <Link href="/notifications" className="glass-panel glass-panel-hover block rounded-2xl p-5 group">
            <div className="size-10 rounded-xl bg-surface-2 border border-line flex items-center justify-center text-ink-2 mb-3 group-hover:scale-105 transition-transform">
              <BellOff className="size-5" aria-hidden />
            </div>
            <div className="font-display text-base font-bold text-ink">Inbox & Updates</div>
            <div className="mt-1 text-xs text-ink-3">Live decision updates on leave and attendance claims</div>
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
    <div className="space-y-8 fade-in-up">
      {/* High-Impact Executive Hero with Kinetic Typography and Spotlight Glow */}
      <GlowCard glowColor="monochrome" customSize className="w-full rounded-3xl p-6 sm:p-8 glass-panel border border-line shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-mono font-medium rounded-full bg-surface-2 border border-line text-ink-3">
              <span className="size-1.5 rounded-full bg-ink" />
              Institutional HRMS · Active
            </div>
            <h1 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight text-ink">
              Good {timeOfDay()},{" "}
              <span className="inline-block -skew-x-[12deg] text-ink underline decoration-1 underline-offset-4">
                {(me?.full_name ?? '').split(' ')[0] || 'Admin'}
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-ink-3 flex items-center gap-2 font-mono">
              <span className="font-semibold text-ink">
                {new Date(`${board.shift_date}T00:00:00Z`).toLocaleDateString('en-IN', {
                  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
                })}
              </span>
              <span>•</span>
              <span className="text-ink-3 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-ink-3" />
                Live Verification Engine
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/board"
              className="inline-flex items-center gap-2 rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider shadow-xs hover:opacity-90 transition-transform active:scale-95 cursor-pointer"
            >
              <CalendarRange className="size-4" />
              Live Board
            </Link>
            <Link
              href="/leave"
              className="inline-flex items-center gap-2 rounded-xl glass-panel border border-line px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-ink hover:bg-surface-2 transition-all active:scale-95 cursor-pointer"
            >
              <ClipboardList className="size-4 text-ink-3" />
              Approvals Queue
            </Link>
          </div>
        </div>
      </GlowCard>

      {/* Kinetic Velocity Live Ticker */}
      <KineticTicker />

      {/* Workforce Metric Tiles */}
      <section className="space-y-3" aria-label="Today's workforce">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
            Workforce Presence
          </h2>
          <span className="text-[11px] font-mono text-ink-3">
            Headcount: <strong className="text-ink">{board.summary.headcount}</strong>
          </span>
        </div>
        {/* Each count links to the register filtered to the people it counts
            - the number and its names are one fact, one click apart. */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          <MetricTile index={0} label="In office" icon="userCheck" href="/board?f=in_office#register" value={board.summary.currently_in} sub={`of ${board.summary.headcount} team members`} tone="neutral" />
          <MetricTile index={1} label="Present" icon="person" href="/board?f=present#register" value={board.summary.present} sub="full shift completed" tone="neutral" />
          <MetricTile index={2} label="Late" icon="clock" href="/board?f=late#register" value={board.summary.late} sub="past grace window" tone="neutral" />
          <MetricTile index={3} label="Absent" icon="bellOff" href="/board?f=absent#register" value={board.summary.absent} sub="no punch recorded" tone="neutral" />
          <MetricTile index={4} label="On leave" icon="calendar" href="/board?f=on_leave#register" value={board.summary.on_leave} sub="approved leave today" tone="neutral" />
        </div>
      </section>

      {/* Attendance Pulse */}
      <section className="space-y-3" aria-label="Today's check-ins over time">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
          Attendance Pulse · Today's Flow
        </h2>
        <AttendancePulse rows={board.rows} />
      </section>

      {/* Waiting on You Queues */}
      <section className="space-y-3" aria-label="Waiting on you">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
          Approvals & Operations
        </h2>
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
          <MetricTile
            index={0} label="Leave requests" icon="clipboard" href="/leave"
            value={pendingLeave.ok ? pendingLeave.data.length : '—'} sub="pending decision" tone="neutral"
          />
          {caps.canDecideCorrections && (
            <MetricTile
              index={1} label="Corrections" icon="clipboard" href="/corrections"
              value={pendingCorrections?.ok ? pendingCorrections.data.length : '—'} sub="pending decision" tone="neutral"
            />
          )}
          <MetricTile
            index={2} label="Exceptions" icon="alert" href="/board?f=exceptions#register"
            value={board.summary.exceptions} sub="unpaired or flagged" tone="neutral"
          />
          <MetricTile
            index={3} label="Refused punches" icon="range" href="/board#refused"
            value={rejected?.length ?? 0} sub="last 7 days audit" tone="neutral"
          />
        </div>
      </section>

      {/* Attention section */}
      {(exceptions.length > 0 || unconfirmedHolidays.length > 0) && (
        <section className="space-y-3" aria-label="Attention">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
            Requires Attention
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {exceptions.length > 0 && (
              <div className="glass-panel border border-line rounded-2xl p-5">
                <h3 className="text-sm font-semibold flex items-center text-ink">
                  <AlertTriangle className="mr-2 size-4 text-ink-3" aria-hidden />
                  Days requiring adjustment
                </h3>
                <ul className="mt-3 space-y-2 text-sm divide-y divide-line/30">
                  {exceptions.slice(0, 5).map((r) => (
                    <li key={r.employee_code} className="pt-2 first:pt-0 flex flex-wrap items-baseline justify-between gap-x-2">
                      <Link href={`/people/${r.employee_code}`} className="font-medium text-ink hover:underline transition-colors">
                        {r.full_name} ({r.employee_code})
                      </Link>
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-ink-3">in at {hhmm(r.first_in)}</span>
                        <span className="text-ink-2">{r.exception_note}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {unconfirmedHolidays.length > 0 && (
              <div className="glass-panel border border-line rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center text-ink">
                    <AlertTriangle className="mr-2 size-4 text-ink-3" aria-hidden />
                    {unconfirmedHolidays.length} holiday date{unconfirmedHolidays.length === 1 ? '' : 's'} to verify
                  </h3>
                  <p className="mt-2 text-xs text-ink-2 leading-relaxed">
                    Estimated festivals should be verified against official state gazette notifications to avoid marking company dates incorrectly.
                  </p>
                </div>
                <Link href="/leave/policy" className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-ink hover:underline font-mono">
                  Review Holiday Calendar →
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Admin Shortcuts & CSV Export */}
      {caps.canManageEnrolment && (
        <section className="space-y-3" aria-label="Manage">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
            Administration & Registers
          </h2>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
            <MetricTile
              index={0} label="Face Biometrics" icon="scanFace" href="/enrolment"
              value={enrolments ? enrolments.summary.missing : '—'} sub="missing face photo" tone="neutral"
            />
            <MetricTile
              index={1} label="Device Handsets" icon="phone" href="/devices"
              value="→" sub="bound mobile phones" tone="neutral"
            />
            <MetricTile
              index={2} label="Leave Policy" icon="calendar" href="/leave/policy"
              value="→" sub="rules, quotas, holidays" tone="neutral"
            />
            <a
              href={proxy(`/api/v1/admin/export/month.csv?year=${year}&month=${monthNum}`)}
              className="glass-panel glass-panel-hover block rounded-2xl p-5 relative overflow-hidden group cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 text-ink-2 border border-line shadow-xs">
                  <Download className="size-4 text-ink-2" aria-hidden />
                </span>
              </div>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 font-mono">
                Export {monthLabel}
              </div>
              <div className="mt-1 text-sm font-bold text-ink">Attendance Register</div>
              <div className="mt-1 text-xs text-ink-3 font-mono">Live CSV Download</div>
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
