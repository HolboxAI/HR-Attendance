/** Time/date formatting in the org's timezone - never the phone's. */
export const IST = 'Asia/Kolkata';

/** "9:34 AM" from an ISO timestamp (server sends UTC, sometimes naive). */
export function hhmm(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST,
  });
}

export function hoursLabel(min: number): string {
  if (!min) return '—';
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

export function formatHoursMins(min: number): string {
  if (!min || min <= 0) return '0 hrs';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "Mon 8 Sep" from YYYY-MM-DD. */
export function plainDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export function monthTitle(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export const STATUS_META: Record<string, { label: string; glyph: string }> = {
  present:    { label: 'Present',   glyph: '●' },
  half_day:   { label: 'Half day',  glyph: '◐' },
  absent:     { label: 'Absent',    glyph: '○' },
  on_leave:   { label: 'On leave',  glyph: '◇' },
  weekly_off: { label: 'Week off',  glyph: '–' },
  holiday:    { label: 'Holiday',   glyph: '–' },
  not_marked: { label: 'Pending',   glyph: '◌' },
  pending:    { label: 'Pending',   glyph: '◌' },
  approved:   { label: 'Approved',  glyph: '●' },
  rejected:   { label: 'Rejected',  glyph: '○' },
  cancelled:  { label: 'Cancelled', glyph: '–' },
};
