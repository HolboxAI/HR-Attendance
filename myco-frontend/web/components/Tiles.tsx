import Link from 'next/link';
import { AlertTriangle, CalendarOff, CheckCircle2, Clock3, DoorOpen, MonitorPlay } from 'lucide-react';

import type { Board } from '@/lib/format';

/**
 * Stat tiles, not a chart. The data's job here is a handful of headline
 * counts - a bar chart of six numbers would be decoration, not information.
 *
 * Each tile is a LINK to the register filtered to the people it counts.
 * "Absent: 3" that answers "which three?" only after a manual scroll and a
 * chip click was read as a dead card - the number and its names are one
 * fact, so one click must connect them.
 */
export function Tiles({ summary }: { summary: Board['summary'] }) {
  const tiles = [
    {
      label: 'In the office', value: summary.currently_in, sub: `of ${summary.headcount} headcount`,
      icon: DoorOpen, filter: 'in_office',
    },
    {
      label: 'Present today', value: summary.present, sub: 'full shift verified',
      icon: CheckCircle2, filter: 'present',
    },
    {
      label: 'Late arrival', value: summary.late, sub: 'past grace window',
      icon: Clock3, filter: 'late',
    },
    {
      label: 'Absent', value: summary.absent, sub: 'no punches logged',
      icon: CalendarOff, filter: 'absent',
    },
    {
      label: 'WFH', value: summary.wfh || 0, sub: 'remote working',
      icon: MonitorPlay, filter: 'wfh',
    },
    {
      label: 'Needs attention', value: summary.exceptions, sub: 'exceptions to review',
      icon: AlertTriangle, filter: 'exceptions',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={`/board?f=${t.filter}#register`}
            className="glass-panel glass-panel-hover block rounded-2xl p-5 relative overflow-hidden group transition-all cursor-pointer"
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
          </Link>
        );
      })}
    </div>
  );
}
