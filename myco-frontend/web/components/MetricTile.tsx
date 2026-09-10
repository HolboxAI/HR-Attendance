'use client';

import Link from 'next/link';
import {
  AlertTriangle, BellOff, CalendarClock, CalendarDays, CalendarRange,
  CircleUserRound, ClipboardList, MonitorPlay, ScanFace, Smartphone, UserCheck,
} from 'lucide-react';

import { CountUp } from '@/components/CountUp';

/**
 * Icons are referenced by NAME because a server component cannot hand a
 * component function across the client boundary - only serialisable props
 * travel. The map is the client side's own vocabulary.
 */
const ICONS = {
  alert: AlertTriangle,
  bellOff: BellOff,
  clock: CalendarClock,
  calendar: CalendarDays,
  range: CalendarRange,
  person: CircleUserRound,
  clipboard: ClipboardList,
  scanFace: ScanFace,
  phone: Smartphone,
  userCheck: UserCheck,
  wfh: MonitorPlay,
} as const;

export type MetricIcon = keyof typeof ICONS;

type Tone = 'accent' | 'present' | 'late' | 'absent' | 'half' | 'neutral';

const TONE: Record<Tone, { badge: string; num: string }> = {
  accent:  { badge: 'text-ink-2 bg-surface-2 border border-line', num: 'text-ink' },
  present: { badge: 'text-ink-2 bg-surface-2 border border-line', num: 'text-ink' },
  late:    { badge: 'text-ink-2 bg-surface-2 border border-line', num: 'text-ink' },
  absent:  { badge: 'text-ink-2 bg-surface-2 border border-line', num: 'text-ink' },
  half:    { badge: 'text-ink-2 bg-surface-2 border border-line', num: 'text-ink' },
  neutral: { badge: 'text-ink-2 bg-surface-2 border border-line', num: 'text-ink' },
};

/**
 * One tile shape for every headline number: an icon, a label, an animated
 * count and where clicking it takes you. Tiles that lead somewhere are links
 * with hover elevation; tiles that don't, aren't - no false affordances.
 */
export function MetricTile({
  label, value, sub, icon, href, tone = 'neutral', index = 0,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: MetricIcon;
  href?: string;
  tone?: Tone;
  index?: number;
}) {
  const t = TONE[tone];
  const Icon = ICONS[icon];
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 border border-line text-ink-2 shadow-xs">
          <Icon className="size-4 text-ink-2" aria-hidden />
        </span>
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 font-mono">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-ink">
        {typeof value === 'number' ? <CountUp value={value} /> : <span className="tnum font-mono">{value}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-3 font-mono">{sub}</div>}
    </>
  );

  const style = { ['--bx-i' as string]: index };

  if (!href) {
    return (
      <div style={style} className="glass-panel bx-rise-i rounded-2xl p-5 relative overflow-hidden">
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      style={style}
      className="glass-panel glass-panel-hover bx-rise-i block rounded-2xl p-5 relative overflow-hidden group cursor-pointer"
    >
      {body}
    </Link>
  );
}
