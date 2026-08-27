'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { Status } from '@/components/Status';

export type DirectoryRow = {
  code: string;
  name: string;
  department: string | null;
  shift: string;
  status: string;
  currentlyIn: boolean;
  enrolled: boolean | null;   // null = viewer can't see enrolment (not HR)
  deviceBound: boolean | null; // null = viewer can't see devices (not HR)
};

/**
 * The employee directory - composed entirely from endpoints that already
 * exist (board + enrolments + devices), because people-search is a real need
 * and a new API is not. No create/invite controls: those endpoints do not
 * exist yet, and a dead button is worse than a shorter page.
 */
export function Directory({ rows }: { rows: DirectoryRow[] }) {
  const [query, setQuery] = useState('');
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const showHrColumns = rows.some((r) => r.enrolled !== null || r.deviceBound !== null);

  return (
    <div className="space-y-4 fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code or department..."
            aria-label="Search employees"
            className="w-full rounded-xl border border-line/70 glass-panel py-2.5 pl-10 pr-4 text-xs font-mono text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent/40 shadow-sm"
          />
        </div>
        <span className="text-xs font-mono text-ink-3">Showing <strong className="text-ink">{filtered.length}</strong> of {rows.length}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl px-6 py-10 text-center text-sm text-ink-3 font-mono">
          No team members match this search criteria.
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto glass-panel rounded-2xl md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
                  <th className="px-5 py-3.5 font-semibold">Employee</th>
                  <th className="px-5 py-3.5 font-semibold">Shift</th>
                  <th className="px-5 py-3.5 font-semibold">Today</th>
                  {showHrColumns && <th className="px-5 py-3.5 font-semibold">Biometrics</th>}
                  {showHrColumns && <th className="px-5 py-3.5 font-semibold">Handset Device</th>}
                </tr>
              </thead>
              <tbody
                onMouseLeave={() => setHoveredCode(null)}
                className="divide-y divide-line/30"
              >
                {filtered.map((r) => {
                  const isHovered = hoveredCode === r.code;
                  const isDimmed = hoveredCode !== null && !isHovered;
                  return (
                    <tr
                      key={r.code}
                      onMouseEnter={() => setHoveredCode(r.code)}
                      style={{
                        opacity: isDimmed ? 0.25 : 1,
                        transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                      className={`group cursor-pointer transition-all duration-300 ${
                        isHovered ? 'bg-surface-2/80' : 'hover:bg-surface-2/40'
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <Link href={`/people/${r.code}`} className="flex items-center gap-3">
                          <span className="relative shrink-0">
                            <Avatar name={r.name} />
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                                r.currentlyIn ? 'bg-accent shadow-sm bx-pulse' : 'bg-line'
                              }`}
                              aria-hidden
                            />
                          </span>
                          <span className="inline-block transition-transform duration-300 group-hover:translate-x-3">
                            <span className="flex items-center gap-1.5 font-semibold text-ink group-hover:text-accent transition-colors">
                              {r.name}
                              {r.currentlyIn && <span className="sr-only"> (currently in the office)</span>}
                              <ArrowUpRight className="size-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-ink shrink-0" aria-hidden />
                            </span>
                            <span className="block text-xs font-mono text-ink-3">
                              {r.code}{r.department ? ` · ${r.department}` : ''}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-3">{r.shift}</td>
                      <td className="px-5 py-3.5"><Status value={r.status} /></td>
                      {showHrColumns && (
                        <td className="px-5 py-3.5 text-xs font-mono">
                          {r.enrolled === null ? '—' : r.enrolled
                            ? <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-st-present/15 text-st-present border border-st-present/25 font-medium"><span className="size-1.5 rounded-full bg-current" />Enrolled</span>
                            : <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-st-late/15 text-st-late border border-st-late/25 font-medium"><span className="size-1.5 rounded-full bg-current" />No photo</span>}
                        </td>
                      )}
                      {showHrColumns && (
                        <td className="px-5 py-3.5 text-xs font-mono">
                          {r.deviceBound === null ? '—' : r.deviceBound
                            ? <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-st-present/15 text-st-present border border-st-present/25 font-medium"><span className="size-1.5 rounded-full bg-current" />Bound</span>
                            : <span className="text-ink-3 font-medium">None</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Narrow: cards */}
          <div
            onMouseLeave={() => setHoveredCode(null)}
            className="grid gap-2.5 md:hidden"
          >
            {filtered.map((r) => {
              const isHovered = hoveredCode === r.code;
              const isDimmed = hoveredCode !== null && !isHovered;
              return (
                <Link
                  key={r.code}
                  href={`/people/${r.code}`}
                  onMouseEnter={() => setHoveredCode(r.code)}
                  style={{
                    opacity: isDimmed ? 0.25 : 1,
                    transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  className={`group glass-panel flex items-center gap-3 p-4 rounded-2xl transition-all duration-300 ${
                    isDimmed ? 'scale-[0.98]' : 'scale-100 hover:bg-surface-2/60'
                  }`}
                >
                  <span className="relative shrink-0">
                    <Avatar name={r.name} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                        r.currentlyIn ? 'bg-accent' : 'bg-line'
                      }`}
                      aria-hidden
                    />
                  </span>
                  <div className="min-w-0 flex-1 transition-transform duration-300 group-hover:translate-x-2.5">
                    <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                    <span className="block text-xs font-mono text-ink-3">
                      {r.code}{r.department ? ` · ${r.department}` : ''}
                    </span>
                  </div>
                  <Status value={r.status} size="xs" />
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
