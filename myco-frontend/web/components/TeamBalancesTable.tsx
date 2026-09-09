'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { TeamBalanceRow } from '@/lib/format';
import { HoverProfile } from '@/components/HoverProfile';

export function TeamBalancesTable({
  types,
  entries,
}: {
  types: string[];
  entries: [string, { name: string; cells: Record<string, TeamBalanceRow> }][];
}) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
            <th className="px-4 py-3">Employee</th>
            {types.map((t) => (
              <th key={t} className="px-4 py-3 text-right">
                {t}
                <span className="block font-normal normal-case tracking-normal text-ink-3/70">available</span>
              </th>
            ))}
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
                        <>
                          <span className={cell.available <= 0 ? 'text-st-absent font-semibold' : 'font-bold text-ink'}>
                            {cell.available}
                          </span>
                          <span className="block text-[10px] text-ink-3 font-normal">
                            {cell.used} used / {cell.accrued} accrued
                          </span>
                        </>
                      ) : '—'}
                    </td>
                  );
                })}
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
  );
}
