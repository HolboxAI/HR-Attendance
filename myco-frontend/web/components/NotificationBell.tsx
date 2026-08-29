'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import {
  AlarmClock, Bell, CalendarClock, CalendarPlus, ClipboardList, LogOut, ScanFace,
} from 'lucide-react';

import type { NotificationRow } from '@/lib/format';
import { notificationHref, timeAgo } from '@/lib/format';

/**
 * One glyph per category the backend actually emits - including the
 * scheduler's nudges (late check-in, missing punch-out, monthly accrual),
 * which with PUSH_PROVIDER=null exist ONLY here. An unrecognised category
 * falls back to the plain bell rather than rendering nothing.
 */
function categoryIcon(category: string) {
  const cls = 'size-3.5';
  if (category === 'attendance_late') return <AlarmClock className={cls} aria-hidden />;
  if (category === 'attendance_punch_out') return <LogOut className={cls} aria-hidden />;
  if (category === 'leave_accrual') return <CalendarPlus className={cls} aria-hidden />;
  if (category.startsWith('leave')) return <CalendarClock className={cls} aria-hidden />;
  if (category.startsWith('correction')) return <ClipboardList className={cls} aria-hidden />;
  if (category.startsWith('enrolment')) return <ScanFace className={cls} aria-hidden />;
  return <Bell className={cls} aria-hidden />;
}

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
    // The scheduler writes nudges while a tab sits open all day, so a
    // count fetched once at mount goes stale by mid-morning. Poll on the
    // scheduler's own cadence and refresh when the tab regains focus -
    // cheap (one count query) and honest.
    function refresh() {
      fetch('/api/gateway/api/v1/notifications/unread-count')
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => body && setUnread(body.unread))
        .catch(() => undefined);
    }
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
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
        className="relative size-9 rounded-xl glass-panel border border-line flex items-center justify-center text-ink hover:bg-surface-2 transition-all cursor-pointer shadow-xs active:scale-95"
      >
        <Bell className="size-4 text-ink-2" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-bold font-mono text-ground shadow-sm"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* The backdrop is a PORTAL because the topbar animates its own
          transform, and a transformed ancestor turns `fixed` into "fixed to
          the topbar" - the blur would cover a 58px strip instead of the
          page. From <body>, z-15 slots above the content (z-10) and below
          the topbar (z-20), so the page behind the panel blurs while the
          dropdown itself stays crisp. Only rendered while open, so it never
          runs on the server. */}
      {open &&
        createPortal(
          <div
            aria-hidden
            className="fixed inset-0 z-[15] bg-black/20 backdrop-blur-[6px]"
          />,
          document.body,
        )}

      {open && (
        <div className="bx-pop absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-2xl glass-panel border border-line bg-surface/95 backdrop-blur-2xl shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
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
                Nothing yet - leave and correction decisions, check-in
                reminders and punch-out nudges all land here.
              </p>
            ) : (
              items.map((n) => {
                // Every row goes somewhere. Rows that name an action deep-link
                // to it; everything else (messages included) opens the full
                // notifications page, where Mark as read and Reply live - a
                // dropdown row that only dismissed itself was a dead end.
                const href = notificationHref(n) ?? '/notifications';
                const inner = (
                  <>
                    <span className="flex items-center gap-2">
                      {!n.read && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      )}
                      <span className="shrink-0 text-ink-3">{categoryIcon(n.category)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{n.title}</span>
                      <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(n.created_at)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-2">{n.body}</span>
                  </>
                );
                const cls = `block w-full border-b border-line/60 px-4 py-3 text-left text-sm last:border-0 hover:bg-surface-2/60 ${
                  n.read ? 'opacity-60' : ''
                }`;
                return (
                  <Link
                    key={n.id}
                    href={href}
                    className={cls}
                    onClick={() => {
                      // A message is marked read by replying to it (or by the
                      // page's own button), not by glancing at the dropdown.
                      if (n.category !== 'message') markRead(n);
                      setOpen(false);
                    }}
                  >
                    {inner}
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
