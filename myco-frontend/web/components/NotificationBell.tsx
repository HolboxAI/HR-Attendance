'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import {
  AlarmClock, Bell, CalendarClock, CalendarPlus, Check, CheckCheck,
  ClipboardList, LogOut, MonitorPlay, ScanFace, X,
} from 'lucide-react';

import type { NotificationRow } from '@/lib/format';
import { notificationHref, timeAgo } from '@/lib/format';

function categoryIcon(category: string) {
  const cls = 'size-3.5';
  if (category === 'attendance_late') return <AlarmClock className={cls} aria-hidden />;
  if (category === 'attendance_punch_out') return <LogOut className={cls} aria-hidden />;
  if (category === 'leave_accrual') return <CalendarPlus className={cls} aria-hidden />;
  if (category.startsWith('leave')) return <CalendarClock className={cls} aria-hidden />;
  if (category.startsWith('correction')) return <ClipboardList className={cls} aria-hidden />;
  if (category.startsWith('enrolment')) return <ScanFace className={cls} aria-hidden />;
  if (category.startsWith('wfh')) return <MonitorPlay className={cls} aria-hidden style={{ color: '#0ea5e9' }} />;
  return <Bell className={cls} aria-hidden />;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function refresh() {
      fetch('/api/gateway/api/v1/notifications/unread-count')
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => body && setUnread(body.unread))
        .catch(() => undefined);
    }
    refresh();
    const timer = setInterval(refresh, 15_000);
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
      // Fetch only unread notifications so previous viewed ones don't clutter the bell
      const res = await fetch('/api/gateway/api/v1/notifications?unread_only=true').catch(() => null);
      if (res?.ok) {
        const unreadItems = (await res.json()) as NotificationRow[];
        setItems(unreadItems);
        setUnread(unreadItems.length);
      }
    }
  }

  async function markRead(n: NotificationRow) {
    // Immediately remove from the bell dropdown so viewed notifications don't pile up
    setItems((cur) => (cur ? cur.filter((x) => x.id !== n.id) : []));
    setUnread((c) => Math.max(0, c - 1));
    await fetch(`/api/gateway/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(
      () => undefined,
    );
  }

  async function markAllRead() {
    if (!items || items.length === 0) return;
    const toMark = [...items];
    setItems([]);
    setUnread(0);
    await Promise.all(
      toMark.map((n) =>
        fetch(`/api/gateway/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(
          () => undefined,
        ),
      ),
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

      {open &&
        createPortal(
          <div
            aria-hidden
            className="fixed inset-0 z-[15] bg-black/20 backdrop-blur-[6px]"
          />,
          document.body,
        )}

      {open && (
        <div className="bx-pop absolute right-0 z-30 mt-2 w-84 overflow-hidden rounded-2xl glass-panel border border-line bg-surface/95 backdrop-blur-2xl shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-ink font-mono flex items-center gap-1.5">
              Notifications
              {unread > 0 && (
                <span className="rounded-full bg-surface-2 border border-line px-1.5 py-0.2 text-[10px] text-ink-3">
                  {unread}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {items && items.length > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11px] font-mono text-ink-3 hover:text-ink flex items-center gap-1 transition-colors cursor-pointer"
                  title="Mark all as read"
                >
                  <CheckCheck className="size-3" />
                  Mark all
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-accent hover:underline font-mono"
              >
                View all
              </Link>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto bx-scroll divide-y divide-line/40">
            {items === null ? (
              <p className="px-4 py-6 text-center text-xs text-ink-3 font-mono">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Check className="size-6 text-green-500 mx-auto mb-2 opacity-80" />
                <p className="text-xs font-semibold text-ink">You&apos;re all caught up</p>
                <p className="text-[11px] text-ink-3 font-mono mt-1">No unread notifications</p>
              </div>
            ) : (
              items.map((n) => {
                const href = notificationHref(n) ?? '/notifications';
                return (
                  <div
                    key={n.id}
                    className="group relative flex items-start justify-between gap-2 px-4 py-3 hover:bg-surface-2/60 transition-colors"
                  >
                    <Link
                      href={href}
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => {
                        markRead(n);
                        setOpen(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        <span className="shrink-0 text-ink-3">{categoryIcon(n.category)}</span>
                        <span className="min-w-0 flex-1 truncate font-medium text-ink text-xs">{n.title}</span>
                        <span className="shrink-0 text-[10px] font-mono text-ink-3">{timeAgo(n.created_at)}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-2 line-clamp-2 pl-3.5 font-mono">{n.body}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        markRead(n);
                      }}
                      title="Mark as read"
                      className="shrink-0 size-6 rounded-md border border-line/60 flex items-center justify-center text-ink-3 hover:text-ink hover:bg-surface-2 transition-all opacity-0 group-hover:opacity-100 cursor-pointer mt-0.5"
                    >
                      <Check className="size-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
