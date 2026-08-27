'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import type { BoardRow } from '@/lib/format';
import { BoardTable } from './BoardTable';

type FilterKey = 'all' | 'present' | 'late' | 'absent' | 'on_leave' | 'exceptions';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Absent' },
  { key: 'on_leave', label: 'On leave' },
  { key: 'exceptions', label: 'Exceptions' },
];

function matches(row: BoardRow, filter: FilterKey): boolean {
  switch (filter) {
    case 'all': return true;
    case 'late': return row.late_minutes > 0;
    case 'exceptions': return row.has_exception;
    default: return row.status === filter;
  }
}

/**
 * Search and status filters over rows the server already sent - no request
 * fires as you type or click a chip. The board is at most ~60 rows (PRD
 * scope), so filtering in the browser is instant and asking the API to do it
 * would just add a round trip for the same result.
 */
export function BoardToolbar({ rows }: { rows: BoardRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => matches(r, filter))
      .filter(
        (r) =>
          !q ||
          r.full_name.toLowerCase().includes(q) ||
          r.employee_code.toLowerCase().includes(q) ||
          (r.department ?? '').toLowerCase().includes(q),
      );
  }, [rows, query, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code or department"
            className="w-full rounded border border-line bg-surface-2 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3"
          />
        </div>
        <span className="text-xs text-ink-3">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line text-ink-2 hover:border-ink-3'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bx-card px-4 py-8 text-center text-sm text-ink-3">
          Nobody matches this search.
        </div>
      ) : (
        <BoardTable rows={filtered} />
      )}
    </div>
  );
}
