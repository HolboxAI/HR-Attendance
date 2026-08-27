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
    <div className="bx-card p-5">
      <h3 className="font-display text-base font-bold">Monthly accrual</h3>
      <p className="mt-1 text-sm text-ink-2">
        Credits one month of each accruing leave type to everyone. Safe to run
        twice - a month already credited is skipped, never doubled, so a
        second click costs nothing.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block text-xs text-ink-3">
          Year
          <input
            type="number" value={year} min={2024} max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            className="tnum mt-1 w-24 rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-ink-3">
          Month
          <select
            value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="mt-1 rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{monthLabel(2000, m).split(' ')[0]}</option>
            ))}
          </select>
        </label>
        <button
          type="button" onClick={() => setConfirming(true)} disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Run accrual for {monthLabel(year, month)}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-st-absent"><span aria-hidden>○ </span>{error}</p>
      )}
      {result && (
        <p role="status" className="mt-3 rounded-md bg-st-present/10 px-3 py-2 text-xs text-st-present">
          <span aria-hidden>● </span>
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
    <div className="bx-card p-5">
      <h3 className="font-display text-base font-bold">Year-end carry-forward</h3>
      <p className="mt-1 text-sm text-ink-2">
        Moves what is left of a leave year into the next one. Only types marked
        as carrying forward move anything - Earned Leave up to its cap; CL and
        SL lapse, by policy. The old year&rsquo;s balance is never touched, and each
        run records the amount before the cap, so &ldquo;why only 30, not 34&rdquo;
        always has an answer in the audit.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block text-xs text-ink-3">
          Leave year that is ENDING
          <input
            value={period} onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026"
            className="tnum mt-1 w-28 rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <button
          type="button" onClick={() => setConfirming(true)} disabled={busy || !period.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Run carry-forward from {period || '…'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-st-absent"><span aria-hidden>○ </span>{error}</p>
      )}
      {result && (
        <p role="status" className="mt-3 rounded-md bg-st-present/10 px-3 py-2 text-xs text-st-present">
          <span aria-hidden>● </span>
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
