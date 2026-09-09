import type { BoardRow } from '@/lib/format';

/**
 * The board's filter vocabulary, in a module with no 'use client' on it -
 * the server page validates ?f= with isFilterKey() and the client toolbar
 * renders the chips from FILTERS, and a function exported from a client
 * module cannot be CALLED on the server (Next hands the server a reference,
 * not the function). Shared plain module, usable from both sides.
 */
export type FilterKey =
  | 'all' | 'in_office' | 'wfh' | 'present' | 'late' | 'absent' | 'on_leave' | 'exceptions';

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_office', label: 'In office' },
  { key: 'wfh', label: 'WFH' },
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Absent' },
  { key: 'on_leave', label: 'On leave' },
  { key: 'exceptions', label: 'Exceptions' },
];

export function isFilterKey(v: string | undefined): v is FilterKey {
  return FILTERS.some((f) => f.key === v);
}

export function matchesFilter(row: BoardRow, filter: FilterKey): boolean {
  switch (filter) {
    case 'all': return true;
    case 'in_office': return row.currently_in;
    case 'wfh': return Boolean(row.is_wfh_enabled || row.status === 'wfh');
    case 'late': return row.late_minutes > 0;
    case 'exceptions': return row.has_exception;
    default: return row.status === filter;
  }
}
