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
      // The API's refusals carry the numbers - how many days you have, what
      // clashes - so show them rather than a generic failure.
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

  const field = 'rounded border border-line bg-surface-2 px-3 py-1.5 text-ink';

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
          Your balance
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances.filter((b) => b.is_paid).map((b) => (
            <div key={b.leave_type_id} className="rounded border border-line bg-surface p-4">
              <div className="text-[11px] uppercase tracking-widest text-ink-3">
                {b.name}
              </div>
              <div className="tnum mt-1 font-display text-2xl font-bold">
                {b.available.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                <span className="text-sm font-normal text-ink-3"> left</span>
              </div>
              <div className="tnum mt-1 text-xs text-ink-3">
                {b.accrued.toLocaleString('en-IN', { maximumFractionDigits: 1 })} earned ·{' '}
                {b.used.toLocaleString('en-IN', { maximumFractionDigits: 1 })} taken
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
          Apply for leave
        </h2>
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3 rounded border border-line bg-surface p-4">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">Type</span>
            <select value={code} onChange={(e) => setCode(e.target.value)} className={field}>
              {types.map((t) => (
                <option key={t.id} value={t.code}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">From</span>
            <input type="date" required value={from}
                   onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">
              To <span className="normal-case tracking-normal">(same day if blank)</span>
            </span>
            <input type="date" value={to}
                   onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-2 py-2 text-sm text-ink-2">
            <input type="checkbox" checked={halfStart}
                   onChange={(e) => setHalfStart(e.target.checked)} className="h-4 w-4" />
            Half day
          </label>
          <label className="min-w-[12rem] flex-1 space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   className={`${field} w-full`} />
          </label>
          <button type="submit" disabled={busy}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-[#1A1206] disabled:opacity-50">
            {busy ? 'Sending…' : 'Apply'}
          </button>

          {error && (
            <p role="alert" className="w-full text-sm text-st-absent">
              <span aria-hidden>○ </span>{error}
            </p>
          )}
          {done && (
            <p className="w-full text-sm text-st-present">
              <span aria-hidden>● </span>Sent. It shows as Pending until someone decides.
            </p>
          )}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
          Your requests
        </h2>
        {requests.length === 0 ? (
          <p className="rounded border border-line bg-surface p-5 text-sm text-ink-2">
            You haven&apos;t applied for anything yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Days</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const s = LEAVE_STATUS[r.status] ?? LEAVE_STATUS.pending;
                  const live = r.status === 'pending' || r.status === 'approved';
                  return (
                    <tr key={r.id} className="border-b border-line/60 last:border-0">
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
                            className="rounded border border-line px-2 py-1 text-xs text-ink-2 disabled:opacity-50"
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
