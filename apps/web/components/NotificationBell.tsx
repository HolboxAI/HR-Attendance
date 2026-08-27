'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

type Notification = {
  id: string;
  category: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

/**
 * A real bell, not a decorative one.
 *
 * `notify()` on the backend always writes a row - that plumbing exists today,
 * independent of whether anything ever pushes to a phone (PUSH_PROVIDER=null).
 * The PRD is explicit that notifications must never be the sole source of
 * truth, which means the in-product list has to work on its own; this is that
 * list, not a placeholder for the day push exists.
 *
 * Goes through /api/gateway rather than a server component because opening a
 * dropdown and marking a row read are both user actions that need to happen
 * without a full page navigation.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/gateway/api/v1/notifications/unread-count')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body && setUnread(body.unread))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) {
      const res = await fetch('/api/gateway/api/v1/notifications').catch(() => null);
      if (res?.ok) setItems((await res.json()).slice(0, 10));
    }
  }

  async function markRead(n: Notification) {
    if (n.read) return;
    setItems((cur) => cur && cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setUnread((c) => Math.max(0, c - 1));
    await fetch(`/api/gateway/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(
      () => undefined,
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        className="relative rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 bx-card shadow-lg">
          <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-ink-3">
            Notifications
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-ink-3">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-3">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n)}
                  className={`block w-full border-b border-line/60 px-4 py-3 text-left text-sm last:border-0 hover:bg-surface-2/60 ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
                    <span className="font-medium text-ink">{n.title}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-2">{n.body}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
