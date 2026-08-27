import Link from 'next/link';

import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { TeamBalancesTable } from '@/components/TeamBalancesTable';
import { getTeamBalances } from '@/lib/api';
import type { TeamBalanceRow } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/leave/balances, pivoted: the API returns one row per employee
 * per accruing type; a manager scanning "who has what left" wants one row per
 * person with the types as columns. Pure presentation - every number is the
 * API's own.
 */
export default async function TeamBalancesPage() {
  const result = await getTeamBalances();

  if (!result.ok) {
    return (
      <ErrorState
        reason={result.reason}
        forbiddenText="Team balances are for managers and HR - they cover the people whose leave you can decide."
      />
    );
  }

  const rows = result.data;
  const types = [...new Set(rows.map((r) => r.code))];
  const byEmployee = new Map<string, { name: string; cells: Record<string, TeamBalanceRow> }>();
  for (const r of rows) {
    const e = byEmployee.get(r.employee_code)
      ?? { name: r.full_name, cells: {} };
    e.cells[r.code] = r;
    byEmployee.set(r.employee_code, e);
  }
  const period = rows[0]?.period;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team balances"
        sub={
          period
            ? `Everyone you can see, for the ${period} leave year. Accrued minus used - the same numbers each person sees on their own Leave page.`
            : 'Everyone you can see. Accrued minus used, per leave type.'
        }
      />

      {byEmployee.size === 0 ? (
        <div className="rounded-2xl glass-panel border border-line px-6 py-10 text-center text-xs font-mono text-ink-3">
          Balances appear once the year&rsquo;s accrual has been run.{' '}
          <Link href="/leave/operations" className="text-ink font-semibold underline">Run accrual →</Link>
        </div>
      ) : (
        <TeamBalancesTable types={types} entries={[...byEmployee.entries()]} />
      )}
    </div>
  );
}
