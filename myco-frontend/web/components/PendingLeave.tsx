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
  const [partialApproving, setPartialApproving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  async function decide(id: string, approve: boolean, partial_approve: boolean = false, deadline?: string) {
    setBusy(id);
    setError(null);
    const body: any = { approve, note: (approve && !partial_approve) ? null : note || null };
    if (partial_approve) {
      body.partial_approve = true;
      if (deadline) body.medical_document_deadline = new Date(deadline).toISOString();
    }
    const res = await fetch(proxy(`/api/v1/admin/leave/${id}/decide`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError({ id, message: body?.detail ?? 'Could not record that decision' });
      return;
    }
    setRejecting(null);
    setPartialApproving(null);
    setNote('');
    setDeadline('');
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
        const isSickLeave = r.leave_type_code === 'SL' || r.leave_type_code?.toUpperCase().includes('SICK');
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
              {r.status === 'partially_approved' && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600">
                  Partially Approved
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {r.category && (
                <span className="inline-flex items-center text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface-3 text-ink border border-line">
                  <span className="text-ink-3 mr-1">Category:</span>
                  <strong className="text-ink">{r.category}</strong>
                </span>
              )}
              {r.reason && <p className="text-sm text-ink-2">{r.reason}</p>}
            </div>
            
            {r.medical_document_url && (
              <div className="mt-3 p-3.5 rounded-xl border border-line bg-surface-2/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink">✅ Medical Document Uploaded</span>
                    <span className="text-[10px] font-mono text-ink-3">
                      {r.medical_document_submitted_at ? `on ${new Date(r.medical_document_submitted_at).toLocaleDateString()}` : ''}
                    </span>
                  </div>
                  {r.decided_note && (
                    <p className="text-xs text-ink-3 italic">Admin Note: &ldquo;{r.decided_note}&rdquo;</p>
                  )}
                </div>
                <a
                  href={`/api/gateway/api/v1/leave/${r.id}/document/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/40 bg-accent/10 text-accent text-xs font-mono font-bold hover:bg-accent/20 transition-colors shrink-0"
                >
                  📎 View Document
                </a>
              </div>
            )}
            {r.status === 'partially_approved' && !r.medical_document_url && (
              <div className="mt-3 p-3.5 rounded-xl border border-yellow-500/30 bg-yellow-500/5 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-yellow-600">⏳ Awaiting Medical Certificate</span>
                  <span className="text-[10px] font-mono text-ink-3">
                    {r.medical_document_deadline ? `Deadline: ${new Date(r.medical_document_deadline).toLocaleDateString()}` : ''}
                  </span>
                </div>
                {r.decided_note && (
                  <p className="text-xs text-ink-2 font-mono">Sent to employee: &ldquo;{r.decided_note}&rdquo;</p>
                )}
              </div>
            )}

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
            
            {partialApproving === r.id && (
              <div className="mt-3 space-y-3 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5">
                <div className="text-xs font-bold text-yellow-600 uppercase tracking-wide">
                  Sick Leave Partial Approval
                </div>
                <div>
                  <label htmlFor={`pnote-${r.id}`} className="block text-xs font-mono text-ink-2 font-semibold">
                    Message for employee (editable)
                  </label>
                  <textarea
                    id={`pnote-${r.id}`}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Enter message for employee requesting medical documents..."
                    className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>
                <div>
                  <label htmlFor={`deadline-${r.id}`} className="block text-xs font-mono text-ink-3">
                    Document Submission Deadline (Optional)
                  </label>
                  <input
                    id={`deadline-${r.id}`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-xs text-ink"
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {partialApproving === r.id || rejecting === r.id ? null : (
                <>
                  {r.status === 'partially_approved' && r.medical_document_url ? (
                    <button
                      type="button" disabled={busy === r.id} onClick={() => decide(r.id, true, false)}
                      className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:bg-emerald-500 transition-all cursor-pointer shadow-xs"
                    >
                      {busy === r.id ? 'Saving…' : 'Confirm Final Approve'}
                    </button>
                  ) : (
                    <button
                      type="button" disabled={busy === r.id} onClick={() => decide(r.id, true)}
                      className="rounded-xl bg-ink text-ground px-4 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 transition-all cursor-pointer"
                    >
                      {busy === r.id ? 'Saving…' : 'Approve'}
                    </button>
                  )}
                </>
              )}

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
              ) : partialApproving === r.id ? (
                <>
                  <button
                    type="button" disabled={busy === r.id} onClick={() => decide(r.id, true, true, deadline)}
                    className="rounded-xl bg-amber-500 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-amber-600 transition-all cursor-pointer shadow-xs"
                  >
                    Confirm Partial Approve
                  </button>
                  <button
                    type="button" onClick={() => { setPartialApproving(null); setNote(''); setDeadline(''); }}
                    className="rounded-xl border border-line px-4 py-2 text-xs font-mono text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {/* Only display Partial Approve for Sick Leave that is not yet partially approved */}
                  {isSickLeave && r.status !== 'partially_approved' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPartialApproving(r.id);
                        setNote("Please submit your medical certificate / doctor's prescription for verification.");
                      }}
                      className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-yellow-600 px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-yellow-500/20 transition-all cursor-pointer"
                    >
                      Partial Approve…
                    </button>
                  )}
                  <button
                    type="button" onClick={() => setRejecting(r.id)}
                    className="rounded-xl border border-line glass-panel px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer"
                  >
                    Reject…
                  </button>
                </>
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
