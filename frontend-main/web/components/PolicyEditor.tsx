'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { proxy, type LeavePolicyRow, type LeaveTypeRow } from '@/lib/format';

const ACCRUAL: Array<LeaveTypeRow['accrual_rule']> = ['monthly', 'annual', 'none'];

/**
 * The warning is not decoration.
 *
 * The one thing a leave system must never do is silently rewrite what people
 * were told they had. Editing a quota applies from the next accrual run
 * forward; days already earned stay earned. Saying so at the point of saving
 * is the difference between a policy change and an argument in November.
 */
const APPLIES_FROM = 'Applies from next month’s accrual. Existing balances are unchanged.';

export function PolicyEditor({
  policy, types,
}: {
  policy: LeavePolicyRow;
  types: LeaveTypeRow[];
}) {
  const router = useRouter();
  const [pol, setPol] = useState(policy);
  const [rows, setRows] = useState(types);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePolicy() {
    setBusy('policy');
    setError(null);
    setSaved(null);
    const res = await fetch(proxy('/api/v1/admin/leave/policy'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pol),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError('Could not save the policy');
      return;
    }
    setSaved('policy');
    router.refresh();
  }

  async function saveType(t: LeaveTypeRow) {
    setBusy(t.id);
    setError(null);
    setSaved(null);
    const res = await fetch(proxy(`/api/v1/admin/leave/types/${t.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(`Could not save ${t.code}`);
      return;
    }
    setSaved(t.id);
    router.refresh();
  }

  function patch(id: string, change: Partial<LeaveTypeRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  const field = 'rounded border border-line bg-surface-2 px-2 py-1.5 text-ink';

  return (
    <div className="space-y-10">
      {error && (
        <p role="alert" className="text-sm text-st-absent">
          <span aria-hidden>○ </span>{error}
        </p>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
            Company rules
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            These apply to everyone. Changing them takes effect immediately for new
            requests; nothing already approved is recalculated.
          </p>
        </div>

        <div className="grid gap-4 bx-card p-5 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">
              Leave year
            </span>
            <select
              value={pol.year_start_month}
              onChange={(e) => setPol({ ...pol, year_start_month: Number(e.target.value) })}
              className={`${field} w-full`}
            >
              <option value={1}>January – December</option>
              <option value={4}>April – March (financial year)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">
              Backdating window
            </span>
            <input
              type="number" min={0} max={365} value={pol.backdate_days}
              onChange={(e) => setPol({ ...pol, backdate_days: Number(e.target.value) })}
              className={`${field} tnum w-full`}
            />
            <span className="block text-xs text-ink-3">
              Days an employee may apply back. HR can always record older leave.
            </span>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">
              Sandwich rule
            </span>
            <span className="flex items-center gap-2 py-1.5">
              <input
                id="sandwich" type="checkbox" checked={pol.sandwich_rule}
                onChange={(e) => setPol({ ...pol, sandwich_rule: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="sandwich" className="text-sm text-ink-2">
                {pol.sandwich_rule ? 'On' : 'Off'}
              </label>
            </span>
            <span className="block text-xs text-ink-3">
              When on, a weekend between two leave days is also charged as leave.
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button" onClick={savePolicy} disabled={busy === 'policy'}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === 'policy' ? 'Saving…' : 'Save company rules'}
          </button>
          {saved === 'policy' && (
            <span className="text-sm text-st-present"><span aria-hidden>● </span>Saved</span>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
            Leave types
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            <span className="text-st-late" aria-hidden>◐ </span>
            {APPLIES_FROM}
          </p>
        </div>

        <div className="space-y-4">
          {rows.map((t) => (
            <div key={t.id} className="bx-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-lg font-bold">
                  {t.name} <span className="text-sm text-ink-3">{t.code}</span>
                </h3>
                {!t.is_paid && (
                  <span className="text-xs text-ink-3">
                    Unpaid — no balance, deducted from salary later
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-widest text-ink-3">
                    Days per year
                  </span>
                  <input
                    type="number" min={0} step={0.5} value={t.annual_quota}
                    onChange={(e) => patch(t.id, { annual_quota: Number(e.target.value) })}
                    className={`${field} tnum w-full`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-widest text-ink-3">
                    Accrual
                  </span>
                  <select
                    value={t.accrual_rule}
                    onChange={(e) => patch(t.id, {
                      accrual_rule: e.target.value as LeaveTypeRow['accrual_rule'],
                    })}
                    className={`${field} w-full`}
                  >
                    {ACCRUAL.map((a) => (
                      <option key={a} value={a}>
                        {a === 'monthly' ? 'Monthly (1/12 each month)'
                          : a === 'annual' ? 'All at once, year start'
                          : 'No balance'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-widest text-ink-3">
                    Carry forward
                  </span>
                  <span className="flex items-center gap-2 py-1.5">
                    <input
                      id={`cf-${t.id}`} type="checkbox" checked={t.carries_forward}
                      onChange={(e) => patch(t.id, { carries_forward: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <label htmlFor={`cf-${t.id}`} className="text-sm text-ink-2">
                      {t.carries_forward ? 'Yes' : 'Lapses at year end'}
                    </label>
                  </span>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] uppercase tracking-widest text-ink-3">
                    Carry-forward cap
                  </span>
                  <input
                    type="number" min={0} step={0.5} value={t.carry_cap}
                    disabled={!t.carries_forward}
                    onChange={(e) => patch(t.id, { carry_cap: Number(e.target.value) })}
                    className={`${field} tnum w-full disabled:opacity-40`}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox" checked={t.requires_proof}
                    onChange={(e) => patch(t.id, { requires_proof: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Requires proof
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox" checked={t.is_active}
                    onChange={(e) => patch(t.id, { is_active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Available to staff
                </label>

                <div className="ml-auto flex items-center gap-3">
                  {saved === t.id && (
                    <span className="text-sm text-st-present">
                      <span aria-hidden>● </span>Saved — balances unchanged
                    </span>
                  )}
                  <button
                    type="button" onClick={() => saveType(t)} disabled={busy === t.id}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === t.id ? 'Saving…' : `Save ${t.code}`}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
