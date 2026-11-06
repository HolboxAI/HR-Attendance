'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Year remaining vs one calendar month's accrual credit (capped at quota/12).
 */
export function BalancesModeBar({
  mode,
  year,
  month,
}: {
  mode: 'year' | 'month';
  year: number;
  month: number;
}) {
  const router = useRouter();
  const [y, setY] = useState(String(year));
  const [m, setM] = useState(String(month));

  function goMonth() {
    const yy = Number(y);
    const mm = Number(m);
    if (!yy || mm < 1 || mm > 12) return;
    router.push(`/leave/balances?mode=month&year=${yy}&month=${mm}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl glass-panel border border-line p-4">
      <div className="flex gap-2">
        <Link
          href="/leave/balances"
          className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider ${
            mode === 'year'
              ? 'bg-ink text-ground'
              : 'border border-line text-ink hover:bg-surface-2'
          }`}
        >
          Overall year
        </Link>
        <button
          type="button"
          onClick={goMonth}
          className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider ${
            mode === 'month'
              ? 'bg-ink text-ground'
              : 'border border-line text-ink hover:bg-surface-2'
          }`}
        >
          This month
        </button>
      </div>
      {mode === 'month' && (
        <>
          <label className="text-[11px] font-mono uppercase tracking-wider text-ink-3">
            Year
            <input
              type="number"
              value={y}
              onChange={(e) => setY(e.target.value)}
              className="mt-1 block w-24 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink"
            />
          </label>
          <label className="text-[11px] font-mono uppercase tracking-wider text-ink-3">
            Month
            <input
              type="number"
              min={1}
              max={12}
              value={m}
              onChange={(e) => setM(e.target.value)}
              className="mt-1 block w-20 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink"
            />
          </label>
          <button
            type="button"
            onClick={goMonth}
            className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            Show
          </button>
          <p className="w-full text-[11px] text-ink-3 font-mono">
            Month mode edits that month&apos;s accrual credit only (max = annual quota ÷ 12, e.g. 1.5). Unused credit stays in the year balance and stacks into later months.
          </p>
        </>
      )}
      {mode === 'year' && (
        <p className="text-[11px] text-ink-3 font-mono">
          Year mode edits remaining available days for the leave year (opening + accrued − used).
        </p>
      )}
    </div>
  );
}
