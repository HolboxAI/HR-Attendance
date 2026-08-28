'use client';

import { useMemo, useState } from 'react';
import { BellOff, CheckCheck } from 'lucide-react';

import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';
import { notificationHref, timeAgo, type NotificationRow } from '@/lib/format';

const CATEGORY_LABEL: Record<string, string> = {
  leave: 'Leave',
  correction: 'Corrections',
  corrections: 'Corrections',
  attendance: 'Attendance',
};

/** Categories arrive dotted ("correction.submitted"); filter on the family. */
function family(category: string): string {
  return category.split('.')[0];
}

function familyLabel(category: string): string {
  const f = family(category);
  return CATEGORY_LABEL[f] ?? f.charAt(0).toUpperCase() + f.slice(1);
}

/**
 * The full notification list the dropdown can't be (it caps at 8). Filters
 * are built from the categories present in the data rather than a hardcoded
 * set, so a new backend category appears here without a frontend change.
 * These are in-product records - nothing here implies a phone was rung,
 * because with PUSH_PROVIDER=null nothing was, deliberately.
 */
export function NotificationsPage({ initial }: { initial: NotificationRow[] }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<'all' | 'unread' | string>('all');
  const [busy, setBusy] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(initial.map((n) => family(n.category)))],
    [initial],
  );

  const shown = items.filter((n) =>
    filter === 'all' ? true : filter === 'unread' ? !n.read : family(n.category) === filter,
  );
  const unread = items.filter((n) => !n.read);

  async function markRead(n: NotificationRow) {
    if (n.read) return;
    setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    await fetch(`/api/gateway/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(
      () => undefined,
    );
  }

  // There is no bulk endpoint; the loop is honest about that and still gives
  // the person the one gesture they actually want.
  async function markAllRead() {
    setBusy(true);
    const targets = items.filter((n) => !n.read);
    setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    await Promise.all(
      targets.map((n) =>
        fetch(`/api/gateway/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(
          () => undefined,
        ),
      ),
    );
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter notifications">
          {[
            { key: 'all', label: `All · ${items.length}` },
            { key: 'unread', label: `Unread · ${unread.length}` },
            ...categories.map((c) => ({ key: c, label: familyLabel(c) })),
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-mono font-medium transition-all cursor-pointer ${
                filter === f.key
                  ? 'border-ink bg-surface-2 text-ink font-bold shadow-xs'
                  : 'border-line text-ink-3 hover:text-ink hover:bg-surface-2/50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <button
            type="button" onClick={markAllRead} disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-line glass-panel px-3.5 py-1.5 text-xs font-mono font-semibold text-ink hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <CheckCheck className="size-3.5" aria-hidden />
            {busy ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl glass-panel border border-line">
          <EmptyState
            icon={BellOff}
            title={filter === 'unread' ? "You're all caught up." : 'Nothing here yet.'}
            hint="Decisions on your leave and correction requests appear here the moment they happen."
          />
        </div>
      ) : (
        <div 
          onMouseLeave={() => setHoveredId(null)}
          className="rounded-2xl glass-panel border border-line divide-y divide-line/60 overflow-hidden"
        >
          {shown.map((n, i) => {
            const isHovered = hoveredId === n.id;
            const isDimmed = hoveredId !== null && !isHovered;
            // A row that names an action links to where the action happens
            // ("needs a correction" -> that exact pending card); reading it
            // is a side effect of going there. Rows with no destination stay
            // plain mark-as-read buttons.
            const href = notificationHref(n);
            const cls = `bx-rise-i block w-full px-5 py-4 text-left transition-all duration-300 cursor-pointer ${
              isHovered ? 'bg-surface-2/70' : 'hover:bg-surface-2/50'
            } ${isDimmed ? 'opacity-40' : n.read ? 'opacity-60' : 'opacity-100'}`;
            const style = { ['--bx-i' as string]: Math.min(i, 10) };
            const inner = (
              <>
                <span className="flex items-baseline gap-2.5">
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-ink" aria-hidden />}
                  <span className="min-w-0 flex-1 text-xs font-semibold text-ink transition-transform duration-300 group-hover:translate-x-1.5">{n.title}</span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide text-ink-3">
                    {familyLabel(n.category)}
                  </span>
                  <span className="tnum shrink-0 text-[10px] font-mono text-ink-3">{timeAgo(n.created_at)}</span>
                </span>
                <span className="mt-1 block text-xs text-ink-2 font-mono">{n.body}</span>
                {!n.read && <span className="sr-only">Unread. Activate to mark read.</span>}
              </>
            );
            return href ? (
              <Link
                key={n.id} href={href} onClick={() => markRead(n)}
                onMouseEnter={() => setHoveredId(n.id)} style={style} className={cls}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={n.id} type="button" onClick={() => markRead(n)}
                onMouseEnter={() => setHoveredId(n.id)} style={style} className={cls}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
