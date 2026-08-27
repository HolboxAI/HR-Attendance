'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  LEAVE_STATUS, dateRange, proxy,
  type BalanceRow, type LeaveRequestRow, type LeaveTypeRow,
} from '@/lib/format';

export function MyLeave({
  balances, requests, types,
}: {
  balances: BalanceRow[];
  requests: LeaveRequestRow[];
  types: LeaveTypeRow[];
}) {
  const router = useRouter();
  const [code, setCode] = useState(types[0]?.code ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfStart, setHalfStart] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [hoveredReqId, setHoveredReqId] = useState<string | null>(null);
  const [hoveredCardCode, setHoveredCardCode] = useState<string | null>(null);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const res = await fetch(proxy('/api/v1/leave/request'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leave_type_code: code, from_date: from, to_date: to || from,
        half_day_start: halfStart, reason: reason || null,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not submit that request');
      return;
    }
    setFrom(''); setTo(''); setReason(''); setHalfStart(false);
    setDone(true);
    router.refresh();
  }

  async function cancel(id: string) {
    setBusy(true);
    await fetch(proxy(`/api/v1/leave/${id}/cancel`), { method: 'POST' }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  const field = 'rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink transition-all';

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Your balance
        </h2>
        <div
          onMouseLeave={() => setHoveredCardCode(null)}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {balances.filter((b) => b.is_paid).map((b) => {
            const isHovered = hoveredCardCode === b.leave_type_id;
            const isDimmed = hoveredCardCode !== null && !isHovered;
            return (
              <div 
                key={b.leave_type_id} 
                onMouseEnter={() => setHoveredCardCode(b.leave_type_id)}
                className={`rounded-2xl glass-panel border border-line p-5 transition-all duration-300 ${isHovered ? 'bg-surface-2/60 scale-[1.02]' : 'hover:bg-surface-2/40'} ${isDimmed ? 'opacity-40 scale-[0.98]' : 'opacity-100'}`}
              >
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                  {b.name}
                </div>
                <div className="tnum mt-2 font-display text-3xl font-black text-ink">
                  {b.available.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                  <span className="text-xs font-normal text-ink-3 font-mono"> left</span>
                </div>
                <div className="tnum mt-2 text-[11px] text-ink-3 font-mono">
                  {b.accrued.toLocaleString('en-IN', { maximumFractionDigits: 1 })} earned ·{' '}
                  {b.used.toLocaleString('en-IN', { maximumFractionDigits: 1 })} taken
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Apply for leave
        </h2>
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3.5 rounded-2xl glass-panel border border-line p-5 sm:p-6">
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">Type</span>
            <select value={code} onChange={(e) => setCode(e.target.value)} className={field}>
              {types.map((t) => (
                <option key={t.id} value={t.code}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">From</span>
            <input type="date" required value={from}
                   onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              To <span className="normal-case tracking-normal text-ink-3/70">(same day if blank)</span>
            </span>
            <input type="date" value={to}
                   onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-2 py-2 text-xs font-medium text-ink-2 cursor-pointer">
            <input type="checkbox" checked={halfStart}
                   onChange={(e) => setHalfStart(e.target.checked)} className="size-4 rounded border-line" />
            Half day
          </label>
          <label className="min-w-[14rem] flex-1 space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="Brief note on reason..."
                   className={`${field} w-full`} />
          </label>
          <button type="submit" disabled={busy}
                  className="rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all cursor-pointer">
            {busy ? 'Sending…' : 'Apply'}
          </button>

          {error && (
            <p role="alert" className="w-full text-xs text-st-absent font-mono">
              {error}
            </p>
          )}
          {done && (
            <p className="w-full text-xs text-st-present font-mono">
              Sent. It shows as Pending until someone decides.
            </p>
          )}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Your requests
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-2xl glass-panel border border-line p-5 text-xs text-ink-2 font-mono">
            You haven&apos;t applied for anything yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody onMouseLeave={() => setHoveredReqId(null)}>
                {requests.map((r) => {
                  const s = LEAVE_STATUS[r.status] ?? LEAVE_STATUS.pending;
                  const live = r.status === 'pending' || r.status === 'approved';
                  const isHovered = hoveredReqId === r.id;
                  const isDimmed = hoveredReqId !== null && !isHovered;
                  return (
                    <tr 
                      key={r.id} 
                      onMouseEnter={() => setHoveredReqId(r.id)}
                      className={`border-b border-line/60 last:border-0 transition-all duration-300 ${isHovered ? 'bg-surface-2/60' : 'hover:bg-surface-2/30'} ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {dateRange(r.from_date, r.to_date)}
                      </td>
                      <td className="px-4 py-3 text-ink-2">{r.leave_type_code}</td>
                      <td className="tnum px-4 py-3">{r.days}</td>
                      <td className={`px-4 py-3 ${s.tone}`}>
                        <span aria-hidden>{s.glyph} </span>{s.label}
                      </td>
                      <td className="px-4 py-3 text-ink-3">{r.decided_note ?? r.reason ?? ''}</td>
                      <td className="px-4 py-3">
                        {live && (
                          <button
                            type="button" disabled={busy} onClick={() => cancel(r.id)}
                            className="rounded-xl border border-line glass-panel px-3 py-1.5 text-xs font-mono font-semibold text-ink hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
