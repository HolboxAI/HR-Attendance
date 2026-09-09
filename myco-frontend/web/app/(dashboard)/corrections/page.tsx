import { AddPunch } from '@/components/AddPunch';
import { MyCorrections } from '@/components/MyCorrections';
import { PageHeader } from '@/components/PageHeader';
import { PendingCorrections } from '@/components/PendingCorrections';
import { currentIdentity } from '@/lib/session';
import { EmployeeCorrectionSummary } from '@/components/EmployeeCorrectionSummary';
import {
  getBoard, getCorrectionsPending, getCorrectionsSummary, getMyCorrections, getMyMonth,
} from '@/lib/api';


export const dynamic = 'force-dynamic';

/**
 * One Corrections page for everybody, split by what the API lets you do.
 *
 * Everyone gets their own requests and the submit flow - it is the only route
 * out of a broken day (PRD §11.2). HR additionally gets the decision queue
 * and the direct add-punch path. The page asks the API rather than guessing
 * from the role name.
 */
export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  // ?focus= comes from a "needs a correction" notification: land with that
  // exact request highlighted, not just on the right page.
  const { focus } = await searchParams;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };

  const [pending, mine, thisMonth, lastMonth, summary] = await Promise.all([
    getCorrectionsPending(),
    getMyCorrections(),
    getMyMonth(y, m),
    getMyMonth(prev.y, prev.m),
    getCorrectionsSummary().catch(() => ({ ok: false, data: [] })),
  ]);

  const isHr = pending.ok;
  const today = new Date().toISOString().slice(0, 10);
  const pendingDays = new Set((mine ?? []).filter((r) => r.status === 'pending').map((r) => r.shift_date));
  const identity = await currentIdentity();
  const correctionLimit = identity?.correction_limit ?? 5;

  const flagged = [...(lastMonth?.days ?? []), ...(thisMonth?.days ?? [])]
    .filter((d) => d.has_exception && d.date <= today && !pendingDays.has(d.date))
    .slice(-6);

  // Count used corrections for the current month
  const currentMonthStr = `${y}-${String(m).padStart(2, '0')}`;
  const usedCorrections = (mine ?? []).filter((r) => 
    r.shift_date.startsWith(currentMonthStr) && 
    (r.status === 'pending' || r.status === 'approved')
  ).length;

  const board = isHr ? await getBoard() : null;
  const employees = board?.ok
    ? board.data.rows.map((r) => ({ code: r.employee_code, name: r.full_name }))
    : [];

  return (
    <div className="space-y-10">
      <PageHeader
        title="Corrections"
        sub={
          isHr
            ? 'Approving adds the punch and recomputes the day immediately - the original events are never touched, so the evidence behind every decision stays intact.'
            : 'A flagged day gets fixed by asking - submit the time you actually punched, and HR decides. Nothing changes until they approve.'
        }
      />

      {isHr && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Waiting for a decision · {pending.data.length}
          </h2>
          <PendingCorrections rows={pending.data} focus={focus ?? null} />
        </section>
      )}

      {isHr && summary.ok && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Employee Correction Summary
          </h2>
          <EmployeeCorrectionSummary summary={summary.data} />
        </section>
      )}

      {isHr && employees.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            Direct entry
          </h2>
          <AddPunch employees={employees} />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Yours
        </h2>
        <MyCorrections rows={mine ?? []} flaggedDays={flagged} correctionLimit={correctionLimit} usedCorrections={usedCorrections} />
      </section>
    </div>
  );
}
