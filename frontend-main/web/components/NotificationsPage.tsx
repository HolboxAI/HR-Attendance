'use client';

import { useMemo, useState } from 'react';
import { BellOff, CheckCheck } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { timeAgo, type NotificationRow } from '@/lib/format';

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
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-ink-2 hover:border-ink-3'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <button
            type="button" onClick={markAllRead} disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-50"
          >
            <CheckCheck className="size-3.5" aria-hidden />
            {busy ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="bx-card">
          <EmptyState
            icon={BellOff}
            title={filter === 'unread' ? "You're all caught up." : 'Nothing here yet.'}
            hint="Decisions on your leave and correction requests appear here the moment they happen - even though phone push isn't switched on yet."
          />
        </div>
      ) : (
        <div className="bx-card divide-y divide-line/60">
          {shown.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markRead(n)}
              style={{ ['--bx-i' as string]: Math.min(i, 10) }}
              className={`bx-rise-i block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2/60 ${
                n.read ? 'opacity-60' : ''
              }`}
            >
              <span className="flex items-baseline gap-2">
                {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">{n.title}</span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  {familyLabel(n.category)}
                </span>
                <span className="tnum shrink-0 text-xs text-ink-3">{timeAgo(n.created_at)}</span>
              </span>
              <span className="mt-0.5 block text-sm text-ink-2">{n.body}</span>
              {!n.read && <span className="sr-only">Unread. Activate to mark read.</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
