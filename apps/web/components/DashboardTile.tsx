import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

type Props = {
  label: string;
  icon: LucideIcon;
  href?: string;
  value?: number | string;
  sub?: string;
  tone?: 'accent' | 'present' | 'late' | 'absent' | 'half' | 'neutral';
  soon?: boolean;
};

const TONE: Record<NonNullable<Props['tone']>, string> = {
  accent: 'text-accent bg-accent/10',
  present: 'text-st-present bg-st-present/10',
  late: 'text-st-late bg-st-late/10',
  absent: 'text-st-absent bg-st-absent/10',
  half: 'text-st-half bg-st-half/10',
  neutral: 'text-ink-2 bg-surface-2',
};

/**
 * One tile shape for the whole overview - a stat, a shortcut, or a disabled
 * "not built yet" placeholder - so the grid reads as one system rather than
 * looking like it was assembled from a few different components.
 *
 * `soon` tiles stay in the grid rather than being omitted, because the
 * request behind this page was a full-looking dashboard - but they render
 * inert and say so, instead of linking to a page that does not exist.
 */
export function DashboardTile({ label, icon: Icon, href, value, sub, tone = 'neutral', soon }: Props) {
  const badge = TONE[tone];

  const content = (
    <>
      <div className="flex items-start justify-between">
        <span className={`flex size-9 items-center justify-center rounded-md ${badge}`}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        {soon && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            Coming later
          </span>
        )}
      </div>
      <div className="mt-3 text-sm font-medium text-ink">{label}</div>
      {value !== undefined && (
        <div className="tnum mt-0.5 text-2xl font-bold text-ink">{value}</div>
      )}
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </>
  );

  if (soon || !href) {
    return (
      <div className="bx-card cursor-default px-4 py-4 opacity-60">
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className="bx-card block px-4 py-4 transition-shadow hover:shadow-md">
      {content}
    </Link>
  );
}
