'use client';

import { useState } from 'react';
import Link from 'next/link';

import { hhmm, type BoardRow } from '@/lib/format';

export function BoardExceptionsList({ exceptions }: { exceptions: BoardRow[] }) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  return (
    <ul
      onMouseLeave={() => setHoveredCode(null)}
      className="mt-3 space-y-2 divide-y divide-line/30"
    >
      {exceptions.map((r) => {
        const isHovered = hoveredCode === r.employee_code;
        const isDimmed = hoveredCode !== null && !isHovered;
        return (
          <li
            key={r.employee_code}
            onMouseEnter={() => setHoveredCode(r.employee_code)}
            className={`group cursor-pointer pt-2 first:pt-0 flex flex-wrap items-baseline justify-between gap-x-3 text-sm transition-all duration-300 rounded-xl px-3 py-1.5 ${
              isHovered ? 'bg-surface-2/70' : 'hover:bg-surface-2/30'
            } ${isDimmed ? 'opacity-30' : 'opacity-100'}`}
          >
            <Link
              href={`/people/${r.employee_code}`}
              className="font-semibold text-ink transition-transform duration-300 group-hover:translate-x-2 inline-flex items-center gap-1.5"
            >
              {r.full_name} <span className="text-xs font-mono text-ink-3 font-normal">({r.employee_code})</span>
            </Link>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-ink-3">in at {hhmm(r.first_in)}</span>
              <span className="text-ink-2 font-medium">{r.exception_note}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
