import type { Board } from '@/lib/format';

/**
 * Stat tiles, not a chart. The data's job here is a handful of headline
 * counts - a bar chart of six numbers would be decoration, not information.
 */
export function Tiles({ summary }: { summary: Board['summary'] }) {
  const tiles = [
    { label: 'In the office', value: summary.currently_in, sub: `of ${summary.headcount}`, tone: 'text-accent' },
    { label: 'Present today', value: summary.present, sub: 'full days', tone: 'text-st-present' },
    { label: 'Late', value: summary.late, sub: 'past grace', tone: 'text-st-late' },
    { label: 'Absent', value: summary.absent, sub: 'no punches', tone: 'text-st-absent' },
    { label: 'Needs attention', value: summary.exceptions, sub: 'exceptions', tone: 'text-st-late' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded border border-line bg-surface px-4 py-3">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">{t.label}</div>
          <div className={`tnum mt-1 text-3xl font-bold ${t.tone}`}>{t.value}</div>
          <div className="text-xs text-ink-3">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
