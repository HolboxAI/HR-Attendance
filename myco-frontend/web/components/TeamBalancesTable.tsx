'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TeamBalanceRow } from '@/lib/format';
import { HoverProfile } from '@/components/HoverProfile';
import {
  BalanceCellEditor,
  EveryoneBalancesBar,
  MonthCreditCellEditor,
  MonthlyMaxCellEditor,
} from '@/components/EditLeaveBalances';

export function TeamBalancesTable({
  types,
  entries,
  canEdit,
  editMode = 'year',
  creditYear,
  creditMonth,
}: {
  types: string[];
  entries: [string, {
    name: string;
    monthlyLeaveMax: number | null;
    cells: Record<string, TeamBalanceRow>;
  }][];
  canEdit?: boolean;
  editMode?: 'year' | 'month';
  creditYear?: number;
  creditMonth?: number;
}) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const monthMode = editMode === 'month' && creditYear != null && creditMonth != null;

  return (
    <div className="space-y-4">
      {canEdit && !monthMode && <EveryoneBalancesBar types={types} />}
      <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3">Employee</th>
              {types.map((t) => (
                <th key={t} className="px-4 py-3 text-right">
                  {t}
                  <span className="block font-normal normal-case tracking-normal text-ink-3/70">
                    {monthMode ? 'month credit' : 'available'}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-right">
                Max / month
                <span className="block font-normal normal-case tracking-normal text-ink-3/70">leave days</span>
              </th>
              <th className="px-4 py-3 text-right">
                Exceeded
                <span className="block font-normal normal-case tracking-normal text-ink-3/70">leaves</span>
              </th>
            </tr>
          </thead>
          <tbody
            onMouseLeave={() => setHoveredCode(null)}
          >
            {entries.map(([code, e]) => {
              const isHovered = hoveredCode === code;
              const isDimmed = hoveredCode !== null && !isHovered;
              const exceeded = types.filter(t => {
                const cell = e.cells[t];
                return cell && cell.available < 0;
              });
              return (
                <tr
                  key={code}
                  onMouseEnter={() => setHoveredCode(code)}
                  className={`border-b border-line/60 last:border-0 transition-all duration-300 ${
                    isHovered ? 'bg-surface-2/60' : 'hover:bg-surface-2/30'
                  } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
                >
                  <td className="px-4 py-3">
                    <HoverProfile data={{ name: e.name, code: code }}>
                      <Link href={`/people/${code}`} className="font-semibold text-ink group inline-flex items-center gap-1.5 transition-transform duration-300 hover:translate-x-1">
                        {e.name}
                      </Link>
                    </HoverProfile>
                    <span className="ml-2 text-xs font-mono text-ink-3">{code}</span>
                  </td>
                  {types.map((t) => {
                    const cell = e.cells[t];
                    return (
                      <td key={t} className="tnum px-4 py-3 text-right font-mono">
                        {cell ? (
                          monthMode && canEdit ? (
                            <MonthCreditCellEditor
                              empCode={code}
                              code={t}
                              year={creditYear!}
                              month={creditMonth!}
                              credit={cell.month_credit ?? 0}
                              cap={cell.month_credit_cap ?? 0}
                              available={cell.available}
                            />
                          ) : canEdit ? (
                            <BalanceCellEditor
                              empCode={code}
                              code={t}
                              available={cell.available}
                              used={cell.used}
                              accrued={cell.accrued}
                            />
                          ) : monthMode ? (
                            <>
                              <span className="font-bold text-ink">{cell.month_credit ?? 0}</span>
                              <span className="block text-[10px] text-ink-3 font-normal">
                                max {cell.month_credit_cap ?? '—'} · year left {cell.available}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={cell.available <= 0 ? 'text-st-absent font-semibold' : 'font-bold text-ink'}>
                                {cell.available}
                              </span>
                              <span className="block text-[10px] text-ink-3 font-normal">
                                {cell.used} used / {cell.accrued} accrued
                              </span>
                            </>
                          )
                        ) : '—'}
                      </td>
                    );
                  })}
                  <td className="tnum px-4 py-3 text-right font-mono">
                    {canEdit ? (
                      <div className="flex justify-end">
                        <MonthlyMaxCellEditor
                          empCode={code}
                          monthlyLeaveMax={e.monthlyLeaveMax}
                        />
                      </div>
                    ) : (
                      <span className="font-bold text-ink">
                        {e.monthlyLeaveMax == null ? '—' : e.monthlyLeaveMax}
                      </span>
                    )}
                  </td>
                  <td className="tnum px-4 py-3 text-right font-mono">
                    {exceeded.length > 0 ? (
                      <span className="text-st-absent font-bold">
                        {exceeded.join(', ')}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <p className="text-[11px] text-ink-3 font-mono">
          {monthMode
            ? 'Month mode: pencil edits that month’s accrual credit only (cannot exceed annual÷12). Year remaining updates when credit changes.'
            : 'Hover a remaining number or Max / month and click the pencil to edit. Empty Max / month means no booking cap.'}
        </p>
      )}
    </div>
  );
}
