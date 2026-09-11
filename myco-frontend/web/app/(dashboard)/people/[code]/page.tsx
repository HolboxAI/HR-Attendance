import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { ErrorState } from '@/components/ErrorState';
import { MonthCalendar } from '@/components/MonthCalendar';
import { ResetPasswordButton, SendMessageButton, EditCorrectionLimitButton } from '@/components/PeopleAdmin';
import { Status } from '@/components/Status';
import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity } from '@/lib/session';
import {
  getBoard, getCorrectionsPending, getDevices, getEnrolments, getMonth,
  getRejected, getTeamBalances, hhmm, hours, monthLabel,
} from '@/lib/api';
import { dayMonth, plainDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * One page per person, composed entirely from endpoints that already exist -
 * board (today), month (calendar + totals), enrolment, device, team balances,
 * pending corrections and the refused-punch log filtered to this person.
 * There is no per-employee API and none is needed; the composition is the
 * feature (frontend PRD §5.2).
 *
 * Sections a viewer's role cannot load simply do not render - a manager sees
 * attendance and leave, HR additionally sees enrolment, device and the
 * correction queue. The API decides; this page only reflects it.
 */
export default async function EmployeeDetailPage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { code } = await params;
  const { y, m } = await searchParams;
  const now = new Date();
  const year = Number(y) || now.getUTCFullYear();
  const month = Number(m) || now.getUTCMonth() + 1;

  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  const board = await getBoard();
  if (!board.ok) {
    return (
      <ErrorState
        reason={board.reason}
        forbiddenText="Employee profiles are for managers and HR."
      />
    );
  }

  const todayRow = board.data.rows.find((r) => r.employee_code === code) ?? null;
  const monthData = await getMonth(code, year, month);
  if (!monthData) {
    return (
      <div className="bx-card p-6">
        <h2 className="text-lg font-semibold">No employee {code} in your scope</h2>
        <p className="mt-2 text-sm text-ink-2">
          Either the code doesn&rsquo;t exist or this person doesn&rsquo;t report to you.
        </p>
        <Link href="/people" className="mt-3 inline-block text-sm text-accent">← Back to the directory</Link>
      </div>
    );
  }

  const [enrolments, devices, pendingCorrections, balances, rejected] = await Promise.all([
    getEnrolments(), getDevices(), getCorrectionsPending(), getTeamBalances(), getRejected(30),
  ]);

  const enrolment = enrolments?.rows.find((r) => r.employee_code === code) ?? null;
  const device = devices.ok ? devices.data.find((d) => d.employee_code === code) ?? null : null;
  const corrections = pendingCorrections.ok
    ? pendingCorrections.data.filter((r) => r.employee_code === code)
    : null;
  const myBalances = balances.ok ? balances.data.filter((b) => b.employee_code === code) : null;
  const myRejected = (rejected ?? []).filter((r) => r.employee_code === code);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const notFuture = year < now.getUTCFullYear()
    || (year === now.getUTCFullYear() && month <= now.getUTCMonth() + 1);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bx-rise bx-card flex flex-wrap items-center gap-4 p-5">
        <span className="relative">
          <span className="[&>span]:size-14 [&>span]:text-lg"><Avatar name={monthData.full_name} /></span>
          {todayRow?.currently_in && (
            <span className="bx-pulse absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-accent ring-2 ring-surface" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight">{monthData.full_name}</h1>
          <p className="text-sm text-ink-3">
            {code}
            {todayRow?.department ? ` · ${todayRow.department}` : ''}
            {todayRow ? ` · shift ${todayRow.shift_label}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {todayRow && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink-3">Today</div>
              <Status value={todayRow.status} />
              {todayRow.currently_in && (
                <div className="text-xs text-accent">in the office now</div>
              )}
            </div>
          )}
          {enrolment && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink-3">Enrolment</div>
              {enrolment.enrolled
                ? <span className="text-sm text-st-present"><span aria-hidden>● </span>Enrolled</span>
                : <span className="text-sm text-st-late"><span aria-hidden>◌ </span>No photo</span>}
            </div>
          )}
        </div>
        {/* This page is manager-and-above already; messaging is scoped the
            same way the board is, so anyone who can see this person can
            nudge them. Reset password stays HR-only. */}
        <div className="flex w-full flex-wrap items-start gap-3 border-t border-line/60 pt-3">
          <SendMessageButton code={code} name={monthData.full_name} />
          {caps.canManagePeople && (
            <>
              <ResetPasswordButton code={code} name={monthData.full_name} />
              <EditCorrectionLimitButton code={code} currentLimit={monthData.correction_limit} />
            </>
          )}
        </div>
      </div>

      {/* Month */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Attendance · {monthLabel(year, month)}
          </h2>
          <div className="flex items-center gap-1 text-sm">
            <Link
              href={`/people/${code}?y=${prev.y}&m=${prev.m}`}
              aria-label="Previous month"
              className="rounded-md border border-line p-1.5 text-ink-2 hover:bg-surface-2"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            {notFuture && (
              <Link
                href={`/people/${code}?y=${next.y}&m=${next.m}`}
                aria-label="Next month"
                className="rounded-md border border-line p-1.5 text-ink-2 hover:bg-surface-2"
              >
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            )}
            <Link
              href={`/month/${code}?y=${year}&m=${month}`}
              className="ml-2 text-xs font-medium text-accent hover:underline"
            >
              Full day-by-day table →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Present', value: String(monthData.totals.present ?? 0), tone: 'text-st-present' },
            { label: 'Half days', value: String(monthData.totals.half_day ?? 0), tone: 'text-st-half' },
            { label: 'Absent', value: String(monthData.totals.absent ?? 0), tone: 'text-st-absent' },
            { label: 'Hours', value: hours(monthData.totals.worked_minutes ?? 0), tone: 'text-accent' },
          ].map((t, i) => (
            <div key={t.label} className="bx-card bx-rise-i px-4 py-3" style={{ ['--bx-i' as string]: i }}>
              <div className="text-[11px] uppercase tracking-widest text-ink-3">{t.label}</div>
              <div className={`tnum mt-1 text-2xl font-bold ${t.tone}`}>{t.value}</div>
            </div>
          ))}
        </div>

        <MonthCalendar days={monthData.days} year={year} month={month} />

        {(monthData.totals.late_minutes > 0 || monthData.totals.overtime_minutes > 0) && (
          <p className="text-xs text-ink-3">
            {monthData.totals.late_minutes > 0 && `Late by ${hours(monthData.totals.late_minutes)} total. `}
            {monthData.totals.overtime_minutes > 0 && `Overtime ${hours(monthData.totals.overtime_minutes)} total.`}
          </p>
        )}
      </section>

      {/* Leave balances */}
      {myBalances && myBalances.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Leave balances · {myBalances[0].period}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {myBalances.map((b) => (
              <div key={b.code} className="bx-card px-4 py-3">
                <div className="text-[11px] uppercase tracking-widest text-ink-3">{b.code}</div>
                <div className="tnum mt-1 text-2xl font-bold">{b.available}</div>
                <div className="text-xs text-ink-3">
                  {b.used} used of {b.accrued} accrued
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending corrections */}
      {corrections && corrections.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-st-late">
            Correction requests waiting · {corrections.length}
          </h2>
          <div className="bx-card divide-y divide-line/60">
            {corrections.map((r) => (
              <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-3 text-sm">
                <span className="font-medium">{plainDate(r.shift_date)}</span>
                <span className="text-ink-2">
                  {r.direction === 'in' ? 'Check-in' : 'Check-out'} claimed at{' '}
                  {new Date(r.claimed_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                  })}
                </span>
                <span className="text-ink-3">{r.reason}</span>
                <Link href="/corrections" className="ml-auto text-xs font-medium text-accent hover:underline">
                  Decide →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Refused punches */}
      {myRejected.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Refused punches · last 30 days
          </h2>
          <div className="bx-card divide-y divide-line/60">
            {myRejected.map((r, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 px-4 py-3 text-sm">
                <span className="tnum text-ink-3">{dayMonth(r.at)} · {hhmm(r.at)}</span>
                <span className="text-st-absent">{r.reason}</span>
                {r.distance_m !== null && (
                  <span className="tnum text-xs text-ink-3">{Math.round(r.distance_m)}m from office</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-3">
            Refused punches never count towards hours, but they are kept - when someone says
            &ldquo;the app wouldn&rsquo;t let me check in&rdquo;, this is the answer.
          </p>
        </section>
      )}

      <p className="text-xs text-ink-3">
        <Link href="/people" className="text-accent">← Back to the directory</Link>
      </p>
    </div>
  );
}
