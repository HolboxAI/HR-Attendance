'use client';

import { useMemo, useState } from 'react';
import { BellOff, Check, CheckCheck, Reply, Send } from 'lucide-react';

import Link from 'next/link';

import { EmptyState } from '@/components/EmptyState';
import { FacePeek } from '@/components/FacePeek';
import { notificationHref, timeAgo, type NotificationRow } from '@/lib/format';

const CATEGORY_LABEL: Record<string, string> = {
  leave: 'Leave',
  correction: 'Corrections',
  corrections: 'Corrections',
  attendance: 'Attendance',
  message: 'Messages',
};

/**
 * A message row names its sender in data.from - an emp_code when they have
 * an employee record, their email when not. Only a code has a face to peek
 * at, and only a message can be replied to (the backend enforces both).
 */
function senderCode(n: NotificationRow): string | null {
  if (n.category !== 'message') return null;
  const from = String(n.data?.from ?? '');
  return from && !from.includes('@') ? from.toUpperCase() : null;
}

function senderName(n: NotificationRow): string {
  return n.title.replace(/^(Message|Reply) from /, '');
}

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
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

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

  async function sendReply(n: NotificationRow) {
    const message = replyText.trim();
    if (!message || sending) return;
    setSending(true);
    setReplyError(null);
    const res = await fetch(`/api/gateway/api/v1/notifications/${n.id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch(() => null);
    setSending(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setReplyError(body?.detail ?? 'Could not send the reply - try again.');
      return;
    }
    // The backend marks the original read on reply - mirror that here.
    setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setReplyingId(null);
    setReplyText('');
    setSentId(n.id);
    setTimeout(() => setSentId(null), 4000);
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
            // is a side effect of going there. Messages stay put - their
            // action (reply) happens right here.
            const href = notificationHref(n);
            const code = senderCode(n);
            const canReply = n.category === 'message' && Boolean(n.data?.from);
            const cls = `bx-rise-i block w-full px-5 py-4 text-left transition-all duration-300 ${
              isHovered ? 'bg-surface-2/70' : 'hover:bg-surface-2/50'
            } ${isDimmed ? 'opacity-40' : n.read ? 'opacity-80' : 'opacity-100'}`;
            const style = { ['--bx-i' as string]: Math.min(i, 10) };
            const title = code ? (
              // Same face-on-hover as the Board and Directory: the sender's
              // reference photo floats up beside the cursor.
              <FacePeek code={code} name={senderName(n)}>{n.title}</FacePeek>
            ) : n.title;
            const inner = (
              <>
                <span className="flex items-baseline gap-2.5">
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-ink" aria-hidden />}
                  <span className="min-w-0 flex-1 text-xs font-semibold text-ink">{title}</span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide text-ink-3">
                    {familyLabel(n.category)}
                  </span>
                  <span className="tnum shrink-0 text-[10px] font-mono text-ink-3">{timeAgo(n.created_at)}</span>
                </span>
                <span className="mt-1 block text-xs text-ink-2 font-mono">{n.body}</span>
              </>
            );
            return (
              <div key={n.id} onMouseEnter={() => setHoveredId(n.id)} style={style} className={cls}>
                {href ? (
                  <Link href={href} onClick={() => markRead(n)} className="block cursor-pointer">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}

                {/* The actions the row was missing: reading and replying are
                    now buttons, not side effects someone has to guess at. */}
                <span className="mt-2.5 flex items-center gap-2">
                  {!n.read && (
                    <button
                      type="button" onClick={() => markRead(n)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] font-mono font-semibold text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer"
                    >
                      <Check className="size-3" aria-hidden /> Mark as read
                    </button>
                  )}
                  {canReply && replyingId !== n.id && (
                    <button
                      type="button"
                      onClick={() => { setReplyingId(n.id); setReplyText(''); setReplyError(null); }}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] font-mono font-semibold text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer"
                    >
                      <Reply className="size-3" aria-hidden /> Reply
                    </button>
                  )}
                  {sentId === n.id && (
                    <span role="status" className="flex items-center gap-1 text-[11px] font-mono font-semibold text-ink">
                      <Check className="size-3" aria-hidden /> Reply sent
                    </span>
                  )}
                </span>

                {replyingId === n.id && (
                  <span className="mt-2 block">
                    <textarea
                      autoFocus
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(n); }
                        if (e.key === 'Escape') setReplyingId(null);
                      }}
                      maxLength={1000}
                      rows={2}
                      placeholder={`Reply to ${senderName(n)}...`}
                      className="w-full rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-3 focus:outline-none focus:border-ink/40 focus:ring-1 focus:ring-ink/20"
                    />
                    {replyError && (
                      <span role="alert" className="mt-1 block text-[11px] font-mono text-st-absent">{replyError}</span>
                    )}
                    <span className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button" disabled={sending || !replyText.trim()}
                        onClick={() => sendReply(n)}
                        className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[11px] font-mono font-bold text-ground hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Send className="size-3" aria-hidden /> {sending ? 'Sending…' : 'Send reply'}
                      </button>
                      <button
                        type="button" onClick={() => setReplyingId(null)}
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-mono font-semibold text-ink-3 hover:text-ink transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                    </span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
