'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { HoverProfile } from '@/components/HoverProfile';

import { hhmm, hours, type BoardRow } from '@/lib/format';
import { Avatar } from './Avatar';
import { Status } from './Status';
import { LocationDetailDialog } from './LocationDetailDialog';

export function BoardTable({ rows }: { rows: BoardRow[] }) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto glass-panel rounded-2xl">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
            <th className="px-5 py-3.5 font-semibold">Employee</th>
            <th className="px-5 py-3.5 font-semibold">Shift</th>
            <th className="px-5 py-3.5 font-semibold">Today</th>
            <th className="px-5 py-3.5 font-semibold">In</th>
            <th className="px-5 py-3.5 font-semibold">Out</th>
            <th className="px-5 py-3.5 font-semibold">Hours</th>
            <th className="px-5 py-3.5 font-semibold">Late</th>
            <th className="px-5 py-3.5 font-semibold">OT</th>
            <th className="px-5 py-3.5 font-semibold">Note</th>
          </tr>
        </thead>
        <tbody
          onMouseLeave={() => setHoveredCode(null)}
          className="divide-y divide-line/30"
        >
          {rows.map((r) => {
            const isHovered = hoveredCode === r.employee_code;
            const isDimmed = hoveredCode !== null && !isHovered;
            return (
              <tr
                key={r.employee_code}
                onMouseEnter={() => setHoveredCode(r.employee_code)}
                style={{
                  opacity: isDimmed ? 0.25 : 1,
                  transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className={`group cursor-pointer transition-all duration-300 ${
                  isHovered ? 'bg-surface-2/80' : 'hover:bg-surface-2/40'
                }`}
              >
                <td className="px-5 py-3.5">
                  {/* FacePeek wraps the WHOLE link, not just the avatar - the
                      photo preview should appear whether the cursor lands on
                      the face or the name. */}
                  
                  <HoverProfile data={{ name: r.full_name, department: r.department, code: r.employee_code }}>
                    <Link href={`/people/${r.employee_code}`} className="flex items-center gap-3">
                      <span className="relative shrink-0">
                        <Avatar name={r.full_name} />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                            r.currently_in ? 'bg-ink shadow-xs' : 'bg-line'
                          }`}
                          aria-hidden
                        />
                      </span>
                      <span className="inline-block transition-transform duration-300 group-hover:translate-x-3">
                        <span className="flex items-center gap-1.5 font-semibold text-ink group-hover:text-accent transition-colors">
                          {r.full_name}
                          {r.is_wfh_enabled && (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 tracking-wider">
                              WFH
                            </span>
                          )}
                          {r.currently_in && <span className="sr-only"> (currently in the office)</span>}
                          <ArrowUpRight className="size-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-ink shrink-0" aria-hidden />
                        </span>
                        <span className="block text-xs font-mono text-ink-3">
                          {r.employee_code}{r.department ? ` · ${r.department}` : ''}
                        </span>
                      </span>
                    </Link>
                  </HoverProfile>
                  
                </td>
                <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-3">{r.shift_label}</td>
                <td className="px-5 py-3.5 flex items-center">
                  <Status value={r.status} isRegularized={r.is_regularized} />
                  {r.status === 'wfh' && <LocationDetailDialog employeeCode={r.employee_code} />}
                </td>
                <td className="tnum px-5 py-3.5 font-mono text-xs text-ink">{hhmm(r.first_in)}</td>
                <td className="tnum px-5 py-3.5 font-mono text-xs text-ink">{hhmm(r.last_out)}</td>
                <td className="tnum px-5 py-3.5 font-mono text-xs font-semibold text-ink">{hours(r.worked_minutes)}</td>
                <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-2 font-medium">{r.late_minutes ? `${r.late_minutes}m` : '—'}</td>
                <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-2 font-medium">{r.overtime_minutes ? `${r.overtime_minutes}m` : '—'}</td>
                <td className="px-5 py-3.5 text-xs text-ink-3 font-mono">{r.exception_note ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
