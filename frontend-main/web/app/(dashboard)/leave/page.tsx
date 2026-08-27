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
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Leave</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            {isApprover
              ? 'Approving a request rewrites attendance for those days straight away — the board never disagrees with what was approved.'
              : 'Apply here, and check what you have left. Approved leave shows on your attendance as On leave, not Absent.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isApprover && (
            <Link href="/leave/balances" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">Team balances</Link>
          )}
          {isHr && (
            <>
              <Link href="/leave/operations" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">Accrual &amp; year-end</Link>
              <Link href="/leave/policy" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">Leave policy</Link>
            </>
          )}
        </div>
      </div>

      {isApprover && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
            Waiting for a decision · {pending.data.length}
          </h2>
          <PendingLeave rows={pending.data} />
        </section>
      )}

      {balances && requests && types ? (
        <MyLeave balances={balances} requests={requests} types={types} />
      ) : (
        <p className="rounded border border-st-absent/50 bg-surface p-5 text-sm text-ink-2">
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
