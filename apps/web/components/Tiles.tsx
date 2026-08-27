import { AlertTriangle, CalendarOff, CheckCircle2, Clock3, DoorOpen } from 'lucide-react';

import type { Board } from '@/lib/format';

/**
 * Stat tiles, not a chart. The data's job here is a handful of headline
 * counts - a bar chart of six numbers would be decoration, not information.
 */
export function Tiles({ summary }: { summary: Board['summary'] }) {
  const tiles = [
    {
      label: 'In the office', value: summary.currently_in, sub: `of ${summary.headcount}`,
      icon: DoorOpen, tone: 'text-accent', bg: 'bg-accent/10',
    },
    {
      label: 'Present today', value: summary.present, sub: 'full days',
      icon: CheckCircle2, tone: 'text-st-present', bg: 'bg-st-present/10',
    },
    {
      label: 'Late', value: summary.late, sub: 'past grace',
      icon: Clock3, tone: 'text-st-late', bg: 'bg-st-late/10',
    },
    {
      label: 'Absent', value: summary.absent, sub: 'no punches',
      icon: CalendarOff, tone: 'text-st-absent', bg: 'bg-st-absent/10',
    },
    {
      label: 'Needs attention', value: summary.exceptions, sub: 'exceptions',
      icon: AlertTriangle, tone: 'text-st-late', bg: 'bg-st-late/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="rounded-lg border border-line bg-surface px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className={`flex size-7 items-center justify-center rounded-md ${t.bg}`}>
                <Icon className={`size-4 ${t.tone}`} aria-hidden />
              </span>
              <span className="text-[11px] uppercase tracking-widest text-ink-3">{t.label}</span>
            </div>
            <div className={`tnum mt-2 text-3xl font-bold ${t.tone}`}>{t.value}</div>
            <div className="text-xs text-ink-3">{t.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
