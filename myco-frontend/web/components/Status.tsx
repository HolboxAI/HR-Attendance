/**
 * Status always carries a written label and a glyph, never colour alone.
 * A colourblind viewer, a greyscale printout and a screen reader all get the
 * same information as everyone else. One map for every status vocabulary in
 * the product - attendance, leave, corrections, devices - so the same word
 * never renders two different ways on two screens.
 */
const MAP: Record<string, { label: string; dot: string; text: string; glyph: string }> = {
  /* attendance_day */
  present:    { label: 'Present',   dot: 'bg-ink',        text: 'text-ink font-medium',      glyph: '●' },
  half_day:   { label: 'Half day',  dot: 'bg-ink-3',      text: 'text-ink-2',                glyph: '◐' },
  absent:     { label: 'Absent',    dot: 'bg-ink-3/60',   text: 'text-ink-3',                glyph: '○' },
  on_leave:   { label: 'On leave',  dot: 'bg-ink-3',      text: 'text-ink-2',                glyph: '◇' },
  weekly_off: { label: 'Week off',  dot: 'bg-ink-3/40',   text: 'text-ink-3',                glyph: '–' },
  holiday:    { label: 'Holiday',   dot: 'bg-ink-3/40',   text: 'text-ink-3',                glyph: '–' },
  not_marked: { label: 'Pending',   dot: 'bg-ink-3/40',   text: 'text-ink-3',                glyph: '◌' },
  /* leave_requests / correction_requests */
  pending:    { label: 'Pending',   dot: 'bg-ink-3',      text: 'text-ink-2',                glyph: '◌' },
  approved:   { label: 'Approved',  dot: 'bg-ink',        text: 'text-ink font-medium',      glyph: '●' },
  rejected:   { label: 'Rejected',  dot: 'bg-ink-3/60',   text: 'text-ink-3',                glyph: '○' },
  cancelled:  { label: 'Cancelled', dot: 'bg-ink-3/40',   text: 'text-ink-3',                glyph: '–' },
};

export function Status({ value, size = 'sm' }: { value: string; size?: 'sm' | 'xs' }) {
  const s = MAP[value] ?? MAP.not_marked;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      <span className={`${size === 'xs' ? 'text-xs' : 'text-sm'} ${s.text}`}>{s.label}</span>
    </span>
  );
}

export function statusGlyph(value: string) {
  return (MAP[value] ?? MAP.not_marked).glyph;
}
export function statusLabel(value: string) {
  return (MAP[value] ?? MAP.not_marked).label;
}
export function statusText(value: string) {
  return (MAP[value] ?? MAP.not_marked).text;
}
