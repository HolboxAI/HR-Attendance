import Link from 'next/link';

import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
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
  const byEmployee = new Map<string, { name: string; cells: Map<string, TeamBalanceRow> }>();
  for (const r of rows) {
    const e = byEmployee.get(r.employee_code)
      ?? { name: r.full_name, cells: new Map<string, TeamBalanceRow>() };
    e.cells.set(r.code, r);
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
        <div className="bx-card px-6 py-10 text-center text-sm text-ink-3">
          Balances appear once the year&rsquo;s accrual has been run.{' '}
          <Link href="/leave/operations" className="text-accent">Run accrual →</Link>
        </div>
      ) : (
        <div className="overflow-x-auto bx-card">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                <th className="px-4 py-3 font-medium">Employee</th>
                {types.map((t) => (
                  <th key={t} className="px-4 py-3 text-right font-medium">
                    {t}
                    <span className="block font-normal normal-case tracking-normal">available</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...byEmployee.entries()].map(([code, e]) => (
                <tr key={code} className="bx-rowlink border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/people/${code}`} className="font-medium text-ink hover:text-accent">
                      {e.name}
                    </Link>
                    <span className="ml-2 text-xs text-ink-3">{code}</span>
                  </td>
                  {types.map((t) => {
                    const cell = e.cells.get(t);
                    return (
                      <td key={t} className="tnum px-4 py-3 text-right">
                        {cell ? (
                          <>
                            <span className={cell.available <= 0 ? 'text-st-absent' : 'font-medium'}>
                              {cell.available}
                            </span>
                            <span className="block text-xs text-ink-3">
                              {cell.used} used / {cell.accrued} accrued
                            </span>
                          </>
                        ) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
