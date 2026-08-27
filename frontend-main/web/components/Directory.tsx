'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code or department"
            aria-label="Search employees"
            className="w-full rounded-md border border-line bg-surface-2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3"
          />
        </div>
        <span className="text-xs text-ink-3">{filtered.length} of {rows.length}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="bx-card px-4 py-8 text-center text-sm text-ink-3">
          Nobody matches this search.
        </div>
      ) : (
        <>
          {/* Desktop: table. */}
          <div className="hidden overflow-x-auto bx-card md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">Today</th>
                  {showHrColumns && <th className="px-4 py-3 font-medium">Enrolment</th>}
                  {showHrColumns && <th className="px-4 py-3 font-medium">Device</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.code} className="bx-rowlink border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/people/${r.code}`} className="group flex items-center gap-3">
                        <span className="relative shrink-0">
                          <Avatar name={r.name} />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                              r.currentlyIn ? 'bg-accent' : 'bg-line'
                            }`}
                            aria-hidden
                          />
                        </span>
                        <span>
                          <span className="block font-medium text-ink group-hover:text-accent">
                            {r.name}
                            {r.currentlyIn && <span className="sr-only"> (currently in the office)</span>}
                          </span>
                          <span className="block text-xs text-ink-3">
                            {r.code}{r.department ? ` · ${r.department}` : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="tnum px-4 py-3 text-ink-3">{r.shift}</td>
                    <td className="px-4 py-3"><Status value={r.status} /></td>
                    {showHrColumns && (
                      <td className="px-4 py-3 text-xs">
                        {r.enrolled === null ? '—' : r.enrolled
                          ? <span className="text-st-present"><span aria-hidden>● </span>Enrolled</span>
                          : <span className="text-st-late"><span aria-hidden>◌ </span>No photo</span>}
                      </td>
                    )}
                    {showHrColumns && (
                      <td className="px-4 py-3 text-xs">
                        {r.deviceBound === null ? '—' : r.deviceBound
                          ? <span className="text-st-present"><span aria-hidden>● </span>Bound</span>
                          : <span className="text-ink-3"><span aria-hidden>○ </span>None</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow: cards, not a squeezed table. */}
          <div className="grid gap-2 md:hidden">
            {filtered.map((r) => (
              <Link key={r.code} href={`/people/${r.code}`} className="bx-card flex items-center gap-3 px-4 py-3">
                <span className="relative shrink-0">
                  <Avatar name={r.name} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                      r.currentlyIn ? 'bg-accent' : 'bg-line'
                    }`}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block text-xs text-ink-3">
                    {r.code}{r.department ? ` · ${r.department}` : ''}
                  </span>
                </span>
                <Status value={r.status} size="xs" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
