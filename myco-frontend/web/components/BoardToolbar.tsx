'use client';

import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';

import type { BoardRow } from '@/lib/format';
import { BoardTable } from './BoardTable';
import { PlaceholdersAndVanishInput } from '@/components/ui/placeholders-and-vanish-input';

import { FILTERS, matchesFilter, type FilterKey } from '@/lib/boardFilters';

type GroupByKey = 'none' | 'department' | 'status' | 'wfh';

export function BoardToolbar({ rows, initial = 'all' }: { rows: BoardRow[]; initial?: FilterKey }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>(initial);
  const [groupBy, setGroupBy] = useState<GroupByKey>('none');

  useEffect(() => {
    if (window.location.hash === '#register') {
      document.getElementById('register')?.scrollIntoView();
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => matchesFilter(r, filter))
      .filter(
        (r) =>
          !q ||
          r.full_name.toLowerCase().includes(q) ||
          r.employee_code.toLowerCase().includes(q) ||
          (r.department ?? '').toLowerCase().includes(q),
      );
  }, [rows, query, filter]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') return null;
    const map = new Map<string, BoardRow[]>();
    for (const r of filtered) {
      let key = 'Other';
      if (groupBy === 'department') {
        key = r.department ? r.department : 'Unassigned';
      } else if (groupBy === 'status') {
        key = r.status.replace(/_/g, ' ').toUpperCase();
      } else if (groupBy === 'wfh') {
        key = r.is_wfh_enabled || r.status === 'wfh' ? 'Work From Home (WFH)' : 'In Office';
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, groupBy]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <PlaceholdersAndVanishInput
            placeholders={[
              'Search name, code or department...',
              'Try a name — Himesh, Krish...',
              'Filter by department — Engineering...',
              'Search by code — BX007...',
            ]}
            onChange={(e: any) => setQuery(e.target.value)}
            onSubmit={() => {}}
            className="h-11"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-ink-3 flex items-center gap-1">
              <Layers className="size-3.5 text-ink-3" /> Group:
            </span>
            <div className="flex items-center gap-1 bg-surface-2/60 border border-line rounded-xl p-1 text-[11px]">
              {(
                [
                  { key: 'none', label: 'None' },
                  { key: 'department', label: 'Department' },
                  { key: 'status', label: 'Status' },
                  { key: 'wfh', label: 'WFH' },
                ] as const
              ).map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroupBy(g.key)}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                    groupBy === g.key
                      ? 'bg-surface text-ink font-bold shadow-xs'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs font-mono text-ink-3">
            Showing <strong className="text-ink">{filtered.length}</strong> of {rows.length}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-mono transition-all cursor-pointer ${
              filter === f.key
                ? 'bg-ink text-ground font-semibold shadow-xs'
                : 'glass-panel text-ink-3 hover:text-ink hover:bg-surface-2 border border-line'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl px-6 py-10 text-center text-sm text-ink-3 font-mono">
          No team members match this search filter.
        </div>
      ) : grouped ? (
        <div className="space-y-6">
          {grouped.map(([groupName, groupRows]) => (
            <div key={groupName} className="space-y-2">
              <div className="flex items-center justify-between px-4 py-2 rounded-xl glass-panel border border-line bg-surface-2/40">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
                  <span>{groupName}</span>
                  <span className="rounded-full bg-surface border border-line px-2 py-0.5 text-[10px] text-ink-3 font-normal">
                    {groupRows.length} {groupRows.length === 1 ? 'member' : 'members'}
                  </span>
                </span>
              </div>
              <BoardTable rows={groupRows} />
            </div>
          ))}
        </div>
      ) : (
        <BoardTable rows={filtered} />
      )}
    </div>
  );
}
