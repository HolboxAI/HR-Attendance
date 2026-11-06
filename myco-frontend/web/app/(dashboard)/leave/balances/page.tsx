import Link from 'next/link';

import { BalancesModeBar } from '@/components/BalancesModeBar';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { TeamBalancesTable } from '@/components/TeamBalancesTable';
import { getTeamBalances } from '@/lib/api';
import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity } from '@/lib/session';
import type { TeamBalanceRow } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/leave/balances, pivoted: the API returns one row per employee
 * per accruing type; a manager scanning "who has what left" wants one row per
 * person with the types as columns. Pure presentation - every number is the
 * API's own.
 *
 * ?mode=month&year=&month= switches to editing that month's accrual credit
 * (capped at quota/12). Default is overall year remaining.
 */
export default async function TeamBalancesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  const sp = await Promise.resolve(searchParams ?? {});
  const modeRaw = typeof sp.mode === 'string' ? sp.mode : 'year';
  const mode = modeRaw === 'month' ? 'month' : 'year';
  const now = new Date();
  const year = Number(typeof sp.year === 'string' ? sp.year : now.getFullYear()) || now.getFullYear();
  const month = Number(typeof sp.month === 'string' ? sp.month : now.getMonth() + 1) || (now.getMonth() + 1);

  const result = mode === 'month'
    ? await getTeamBalances({ year, month })
    : await getTeamBalances();

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
  const byEmployee = new Map<string, {
    name: string;
    monthlyLeaveMax: number | null;
    cells: Record<string, TeamBalanceRow>;
  }>();
  for (const r of rows) {
    const e = byEmployee.get(r.employee_code)
      ?? {
        name: r.full_name,
        monthlyLeaveMax: r.monthly_leave_max ?? null,
        cells: {},
      };
    e.cells[r.code] = r;
    if (r.monthly_leave_max != null) e.monthlyLeaveMax = r.monthly_leave_max;
    byEmployee.set(r.employee_code, e);
  }
  const period = rows[0]?.period;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team balances"
        sub={
          mode === 'month'
            ? `Month credit for ${year}-${String(month).padStart(2, '0')} (max = annual ÷ 12 per type). Year remaining still shown.`
            : period
              ? `Everyone you can see, for the ${period} leave year. Accrued minus used, plus each person’s monthly leave max.`
              : 'Everyone you can see. Accrued minus used, per leave type, plus monthly leave max.'
        }
      />

      <BalancesModeBar mode={mode} year={year} month={month} />

      {byEmployee.size === 0 ? (
        <div className="rounded-2xl glass-panel border border-line px-6 py-10 text-center text-xs font-mono text-ink-3">
          Balances appear once the year&rsquo;s accrual has been run.{' '}
          <Link href="/leave/operations" className="text-ink font-semibold underline">Run accrual →</Link>
        </div>
      ) : (
        <TeamBalancesTable
          types={types}
          entries={[...byEmployee.entries()]}
          canEdit={caps.canManageLeavePolicy}
          editMode={mode}
          creditYear={year}
          creditMonth={month}
        />
      )}
    </div>
  );
}
