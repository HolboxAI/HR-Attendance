'use client';

import { useState } from 'react';
import { hhmm, type Rejected } from '@/lib/format';

export function BoardRefusedTable({ rejected }: { rejected: Rejected[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="overflow-x-auto glass-panel rounded-2xl">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
            <th className="px-5 py-3 font-semibold">Who</th>
            <th className="px-5 py-3 font-semibold">When</th>
            <th className="px-5 py-3 font-semibold">Reason Refused</th>
          </tr>
        </thead>
        <tbody
          onMouseLeave={() => setHoveredIdx(null)}
          className="divide-y divide-line/30"
        >
          {rejected.map((r, i) => {
            const isHovered = hoveredIdx === i;
            const isDimmed = hoveredIdx !== null && !isHovered;
            return (
              <tr
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                className={`group cursor-pointer transition-all duration-300 ${
                  isHovered ? 'bg-surface-2/70' : 'hover:bg-surface-2/30'
                } ${isDimmed ? 'opacity-30' : 'opacity-100'}`}
              >
                <td className="px-5 py-3">
                  {/* Refused punches are exactly where HR wants to see the
                      face - the refusal may BE about the face. */}
                  
                    <span className="font-medium text-ink transition-transform duration-300 inline-block group-hover:translate-x-2">{r.full_name}</span>
                    <span className="ml-2 text-xs font-mono text-ink-3">{r.employee_code}</span>
                  
                </td>
                <td className="tnum px-5 py-3 font-mono text-xs text-ink-3">{hhmm(r.at)}</td>
                <td className="px-5 py-3 text-xs font-mono text-st-absent">{r.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
