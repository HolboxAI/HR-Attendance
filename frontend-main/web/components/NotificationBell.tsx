'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

import type { NotificationRow } from '@/lib/format';
import { timeAgo } from '@/lib/format';

/**
 * A real bell, not a decorative one. notify() on the backend always writes a
 * row regardless of push (PUSH_PROVIDER=null rings nothing, deliberately), and
 * the PRD says notifications must never be the sole source of truth - so this
 * in-product list has to work on its own. Goes through /api/gateway because
 * opening a dropdown and marking rows read are user actions that must not
 * need a page navigation.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
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
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const res = await fetch('/api/gateway/api/v1/notifications').catch(() => null);
      if (res?.ok) setItems(((await res.json()) as NotificationRow[]).slice(0, 8));
    }
  }

  async function markRead(n: NotificationRow) {
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
        aria-expanded={open}
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        className="relative rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
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
        <div className="bx-pop absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl bx-glass-strong shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">
              Notifications
            </span>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-accent hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="max-h-80 overflow-y-auto bx-scroll">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-ink-3">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-3">
                Nothing yet - decisions on your leave and corrections will appear here.
              </p>
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
                    {!n.read && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{n.title}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(n.created_at)}</span>
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
