'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { monthLabel, proxy, type AccrueResult, type CarryForwardResult } from '@/lib/format';

/**
 * The two system-level leave jobs, given a real page rather than an icon
 * button - HR runs these a handful of times a year and deserves to see what
 * each one will do, that both are idempotent, and exactly what happened.
 */
export function LeaveOperations() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccrualCard />
      <CarryForwardCard />
    </div>
  );
}

function AccrualCard() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccrueResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(
      proxy(`/api/v1/admin/leave/accrue?year=${year}&month=${month}`),
      { method: 'POST' },
    ).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not run accrual.');
      return;
    }
    setResult((await res.json()) as AccrueResult);
  }

  return (
    <div className="rounded-2xl glass-panel border border-line p-6">
      <h3 className="font-display text-base font-bold text-ink">Monthly accrual</h3>
      <p className="mt-1 text-xs font-mono text-ink-3">
        Credits one month of each accruing leave type to everyone. Safe to run twice - a month already credited is skipped, never doubled.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
          Year
          <input
            type="number" value={year} min={2024} max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            className="tnum mt-1 block w-24 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink font-mono"
          />
        </label>
        <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
          Month
          <select
            value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="mt-1 block rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{monthLabel(2000, m).split(' ')[0]}</option>
            ))}
          </select>
        </label>
        <button
          type="button" onClick={() => setConfirming(true)} disabled={busy}
          className="rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
        >
          Run accrual for {monthLabel(year, month)}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-st-absent font-mono">{error}</p>
      )}
      {result && (
        <p role="status" className="mt-3 rounded-xl border border-line glass-panel px-4 py-3 text-xs text-ink font-mono">
          Credited {result.credited}, already done {result.skipped}.
          {result.credited === 0 && result.skipped > 0 && ' This month had already been run - nothing changed.'}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Run accrual for ${monthLabel(year, month)}?`}
        consequence="Every employee gains one month of each accruing leave type. Balances already credited for this month are skipped, so running it again is a no-op. This is recorded in the leave audit."
        confirmLabel="Run accrual"
        busy={busy}
        onConfirm={run}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

function CarryForwardCard() {
  const now = new Date();
  const [period, setPeriod] = useState(String(now.getUTCFullYear()));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CarryForwardResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(
      proxy(`/api/v1/admin/leave/carry-forward?period=${encodeURIComponent(period)}`),
      { method: 'POST' },
    ).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not run carry-forward.');
      return;
    }
    setResult((await res.json()) as CarryForwardResult);
  }

  return (
    <div className="rounded-2xl glass-panel border border-line p-6">
      <h3 className="font-display text-base font-bold text-ink">Year-end carry-forward</h3>
      <p className="mt-1 text-xs font-mono text-ink-3">
        Moves what is left of a leave year into the next one. Only types marked as carrying forward move anything - Earned Leave up to its cap; CL and SL lapse, by policy.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
          Leave year that is ENDING
          <input
            value={period} onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026"
            className="tnum mt-1 block w-28 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink font-mono"
          />
        </label>
        <button
          type="button" onClick={() => setConfirming(true)} disabled={busy || !period.trim()}
          className="rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
        >
          Run carry-forward from {period || '…'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-st-absent font-mono">{error}</p>
      )}
      {result && (
        <p role="status" className="mt-3 rounded-xl border border-line glass-panel px-4 py-3 text-xs text-ink font-mono">
          Carried {result.from_period} → {result.to_period}: {result.credited} credited,
          {' '}{result.skipped} already done.
          {result.credited === 0 && result.skipped > 0 && ' This boundary had already been run - nothing changed.'}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Carry ${period} leave into ${Number(period) ? Number(period) + 1 : 'the next year'}?`}
        consequence={`What remains of ${period}'s carrying leave types becomes the next period's opening balance, capped per type. ${period}'s own history is read, never rewritten. Running it twice is a no-op - already-carried employees are skipped.`}
        confirmLabel="Run carry-forward"
        busy={busy}
        onConfirm={run}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
