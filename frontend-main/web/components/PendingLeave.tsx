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
      <p className="bx-card p-5 text-sm text-ink-2">
        <span aria-hidden className="text-st-present">● </span>
        Nothing waiting for you.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="bx-card p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium">{r.employee_name}</span>
            <span className="text-xs text-ink-3">{r.employee_code}</span>
            <span className="text-ink-2">
              {r.leave_type_code} · {dateRange(r.from_date, r.to_date)}
            </span>
            <span className="tnum text-ink-3">
              {r.days} day{r.days === 1 ? '' : 's'}
            </span>
          </div>
          {r.reason && <p className="mt-1 text-sm text-ink-2">{r.reason}</p>}

          {rejecting === r.id && (
            <div className="mt-3">
              <label htmlFor={`note-${r.id}`} className="block text-xs text-ink-3">
                Why are you turning this down? They will see this.
              </label>
              <input
                id={`note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
              />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button" disabled={busy === r.id} onClick={() => decide(r.id, true)}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === r.id ? 'Saving…' : 'Approve'}
            </button>
            {rejecting === r.id ? (
              <>
                <button
                  type="button" disabled={busy === r.id} onClick={() => decide(r.id, false)}
                  className="rounded border border-st-absent px-3 py-1.5 text-xs text-st-absent disabled:opacity-50"
                >
                  Confirm reject
                </button>
                <button
                  type="button" onClick={() => { setRejecting(null); setNote(''); }}
                  className="px-2 py-1.5 text-xs text-ink-3"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button" onClick={() => setRejecting(r.id)}
                className="rounded border border-line px-3 py-1.5 text-xs text-ink-2"
              >
                Reject
              </button>
            )}
          </div>

          {error?.id === r.id && (
            <p role="alert" className="mt-2 text-xs text-st-absent">
              <span aria-hidden>○ </span>{error.message}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
