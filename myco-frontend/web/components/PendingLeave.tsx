'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { dateRange, proxy, type LeaveRequestRow } from '@/lib/format';

/**
 * The approver's queue.
 *
 * Your own request never appears here — the API refuses to let anyone decide
 * their own leave, admin included, so listing it would only invite the attempt.
 */
export function PendingLeave({ rows }: { rows: LeaveRequestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    const res = await fetch(proxy(`/api/v1/admin/leave/${id}/decide`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve, note: approve ? null : note || null }),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError({ id, message: body?.detail ?? 'Could not record that decision' });
      return;
    }
    setRejecting(null);
    setNote('');
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl glass-panel border border-line p-5 text-sm text-ink-2">
        Nothing waiting for you.
      </p>
    );
  }

  return (
    <div
      onMouseLeave={() => setHoveredId(null)}
      className="space-y-3"
    >
      {rows.map((r) => {
        const isHovered = hoveredId === r.id;
        const isDimmed = hoveredId !== null && !isHovered;
        return (
          <div
            key={r.id}
            onMouseEnter={() => setHoveredId(r.id)}
            className={`rounded-2xl glass-panel border border-line p-5 transition-all duration-300 ${
              isHovered ? 'bg-surface-2/60 scale-[1.01]' : 'hover:bg-surface-2/40'
            } ${isDimmed ? 'opacity-40 scale-[0.99]' : 'opacity-100'}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              
                <span className="font-semibold text-ink transition-transform duration-300 inline-block group-hover:translate-x-1">{r.employee_name}</span>
                <span className="ml-3 text-xs font-mono text-ink-3">{r.employee_code}</span>
              
              <span className="text-xs font-mono text-ink-2">
                {r.leave_type_code} · {dateRange(r.from_date, r.to_date)}
              </span>
              <span className="tnum text-xs font-mono text-ink-3">
                {r.days} day{r.days === 1 ? '' : 's'}
              </span>
            </div>
            {r.reason && <p className="mt-2 text-sm text-ink-2">{r.reason}</p>}

            {rejecting === r.id && (
              <div className="mt-3">
                <label htmlFor={`note-${r.id}`} className="block text-xs font-mono text-ink-3">
                  Why are you turning this down? They will see this.
                </label>
                <input
                  id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink"
                />
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button" disabled={busy === r.id} onClick={() => decide(r.id, true)}
                className="rounded-xl bg-ink text-ground px-4 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 transition-all cursor-pointer"
              >
                {busy === r.id ? 'Saving…' : 'Approve'}
              </button>
              {rejecting === r.id ? (
                <>
                  <button
                    type="button" disabled={busy === r.id} onClick={() => decide(r.id, false)}
                    className="rounded-xl border border-line glass-panel px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50 hover:bg-surface-2 transition-all cursor-pointer"
                  >
                    Confirm Reject
                  </button>
                  <button
                    type="button" onClick={() => { setRejecting(null); setNote(''); }}
                    className="rounded-xl border border-line px-4 py-2 text-xs font-mono text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button" onClick={() => setRejecting(r.id)}
                  className="rounded-xl border border-line glass-panel px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer"
                >
                  Reject…
                </button>
              )}
            </div>

            {error?.id === r.id && (
              <p role="alert" className="mt-2 text-xs text-st-absent">
                <span aria-hidden>○ </span>{error.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
