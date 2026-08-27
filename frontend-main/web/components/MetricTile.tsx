'use client';

import Link from 'next/link';
import {
  AlertTriangle, BellOff, CalendarClock, CalendarDays, CalendarRange,
  CircleUserRound, ClipboardList, ScanFace, Smartphone, UserCheck,
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
} as const;

export type MetricIcon = keyof typeof ICONS;

type Tone = 'accent' | 'present' | 'late' | 'absent' | 'half' | 'neutral';

const TONE: Record<Tone, { badge: string; num: string }> = {
  accent:  { badge: 'text-accent bg-accent/10',           num: 'text-accent' },
  present: { badge: 'text-st-present bg-st-present/10',   num: 'text-st-present' },
  late:    { badge: 'text-st-late bg-st-late/10',         num: 'text-st-late' },
  absent:  { badge: 'text-st-absent bg-st-absent/10',     num: 'text-st-absent' },
  half:    { badge: 'text-st-half bg-st-half/10',         num: 'text-st-half' },
  neutral: { badge: 'text-ink-2 bg-surface-2',            num: 'text-ink' },
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
        <span className={`flex size-9 items-center justify-center rounded-lg ${t.badge}`}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-3">{label}</div>
      <div className={`mt-0.5 text-3xl font-bold ${t.num}`}>
        {typeof value === 'number' ? <CountUp value={value} /> : <span className="tnum">{value}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </>
  );

  const style = { ['--bx-i' as string]: index };

  if (!href) {
    return <div style={style} className="bx-card bx-rise-i px-4 py-4">{body}</div>;
  }
  return (
    <Link
      href={href}
      style={style}
      className="bx-card bx-rise-i block px-4 py-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
    >
      {body}
    </Link>
  );
}
