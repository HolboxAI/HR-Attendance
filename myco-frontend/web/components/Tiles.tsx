import { AlertTriangle, CalendarOff, CheckCircle2, Clock3, DoorOpen } from 'lucide-react';

import type { Board } from '@/lib/format';

/**
 * Stat tiles, not a chart. The data's job here is a handful of headline
 * counts - a bar chart of six numbers would be decoration, not information.
 */
export function Tiles({ summary }: { summary: Board['summary'] }) {
  const tiles = [
    {
      label: 'In the office', value: summary.currently_in, sub: `of ${summary.headcount} headcount`,
      icon: DoorOpen,
    },
    {
      label: 'Present today', value: summary.present, sub: 'full shift verified',
      icon: CheckCircle2,
    },
    {
      label: 'Late arrival', value: summary.late, sub: 'past grace window',
      icon: Clock3,
    },
    {
      label: 'Absent', value: summary.absent, sub: 'no punches logged',
      icon: CalendarOff,
    },
    {
      label: 'Needs attention', value: summary.exceptions, sub: 'exceptions to review',
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div
            key={t.label}
            className="glass-panel glass-panel-hover rounded-2xl p-5 relative overflow-hidden group transition-all"
          >
            <div className="flex items-start justify-between">
              <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 border border-line text-ink-2 shadow-xs">
                <Icon className="size-4 text-ink-2" aria-hidden />
              </span>
            </div>
            <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 font-mono">
              {t.label}
            </div>
            <div className="tnum mt-1 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">
              {t.value}
            </div>
            <div className="mt-1 text-xs text-ink-3 font-mono">{t.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
