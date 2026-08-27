import Link from 'next/link';

import { HolidayCalendar } from '@/components/HolidayCalendar';
import { MyLeave } from '@/components/MyLeave';
import { PendingLeave } from '@/components/PendingLeave';
import {
  getHolidays, getMyBalance, getMyLeaveTypes, getMyRequests, getPending,
} from '@/lib/api';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * One Leave page for everybody, like the login.
 *
 * Your own balance and requests are always here because every employee has
 * them. The approvals queue and the calendar appear on top when the API says
 * you are an approver — the page asks rather than assuming from the role name.
 */
export default async function LeavePage() {
  const me = await currentIdentity();
  const [balances, requests, types, pending] = await Promise.all([
    getMyBalance(), getMyRequests(), getMyLeaveTypes(), getPending(),
  ]);

  const isApprover = pending.ok;
  const isHr = me?.is_admin ?? false;
  const year = new Date().getUTCFullYear();
  const holidays = isApprover ? await getHolidays(year) : null;

  return (
    <div className="space-y-10 fade-in-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3">
            Workforce Leave System
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight text-ink mt-1">
            Leave Operations
          </h1>
          <p className="mt-1 max-w-prose text-xs sm:text-sm text-ink-3 font-mono">
            {isApprover
              ? 'Approving a request rewrites attendance for those days straight away — zero state drift.'
              : 'Apply here and verify balances. Approved leave reflects automatically across institutional boards.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {isApprover && (
            <Link
              href="/leave/balances"
              className="rounded-xl glass-panel border border-line px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink hover:bg-surface-2 transition-all active:scale-95 cursor-pointer"
            >
              Team balances
            </Link>
          )}
          {isHr && (
            <>
              <Link
                href="/leave/operations"
                className="rounded-xl glass-panel border border-line px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink hover:bg-surface-2 transition-all active:scale-95 cursor-pointer"
              >
                Accrual &amp; year-end
              </Link>
              <Link
                href="/leave/policy"
                className="rounded-xl glass-panel border border-line px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink hover:bg-surface-2 transition-all active:scale-95 cursor-pointer"
              >
                Leave policy
              </Link>
            </>
          )}
        </div>
      </div>

      {isApprover && (
        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
            Waiting for a decision · {pending.data.length}
          </h2>
          <PendingLeave rows={pending.data} />
        </section>
      )}

      {balances && requests && types ? (
        <MyLeave balances={balances} requests={requests} types={types} />
      ) : (
        <p className="rounded-2xl border border-line glass-panel p-6 text-sm text-ink-2">
          Could not load your leave. Try signing out and back in.
        </p>
      )}

      {isApprover && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
            Holidays · {year}
          </h2>
          <HolidayCalendar rows={holidays ?? []} canEdit={isHr} year={year} />
        </section>
      )}
    </div>
  );
}
