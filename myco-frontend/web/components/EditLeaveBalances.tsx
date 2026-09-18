'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, Save } from 'lucide-react';

import { proxy } from '@/lib/format';

export type LeaveDraft = { code: string; available: number };

async function putBalances(path: string, items: LeaveDraft[], note?: string) {
  const res = await fetch(proxy(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((i) => ({
        code: i.code,
        available: i.available,
        ...(note ? { note } : {}),
      })),
    }),
  }).catch(() => null);
  if (!res) throw new Error('Could not reach the API');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === 'string' ? detail : `Save failed (${res.status})`);
  }
  return res.json();
}

export function saveEmployeeBalances(empCode: string, items: LeaveDraft[], note?: string) {
  return putBalances(`/api/v1/admin/leave/balances/${encodeURIComponent(empCode)}`, items, note);
}

export function saveEveryoneBalances(items: LeaveDraft[], note?: string) {
  return putBalances('/api/v1/admin/leave/balances/all', items, note);
}

/** Remaining CL / EL / SL on a person profile. */
export function EmployeeLeaveEditor({
  empCode,
  period,
  rows,
}: {
  empCode: string;
  period: string;
  rows: (LeaveDraft & { used?: number; accrued?: number })[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.code, String(r.available)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save() {
    setError(null);
    setOk(null);
    const items: LeaveDraft[] = rows.map((r) => ({
      code: r.code,
      available: Number(drafts[r.code]),
    }));
    if (items.some((i) => Number.isNaN(i.available) || i.available < 0)) {
      setError('Each remaining figure must be zero or more.');
      return;
    }
    setBusy(true);
    try {
      await saveEmployeeBalances(empCode, items);
      setOk('Saved remaining days for this person.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Leave balances · {period}
        </h2>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save leave days
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r) => (
          <label key={r.code} className="bx-card px-4 py-3 block">
            <div className="text-[11px] uppercase tracking-widest text-ink-3">{r.code}</div>
            <input
              type="number"
              min={0}
              step={0.5}
              value={drafts[r.code] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [r.code]: e.target.value }))}
              className="tnum mt-1 w-full bg-transparent text-2xl font-bold text-ink outline-none border-b border-line/60 focus:border-ink pb-0.5"
            />
            <div className="mt-1 text-xs text-ink-3">
              Remaining
              {r.used != null && r.accrued != null
                ? ` · ${r.used} used / ${r.accrued} accrued`
                : ''}
            </div>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-st-absent font-mono">{error}</p>}
      {ok && <p className="text-xs text-emerald-500 font-mono">{ok}</p>}
      <p className="text-[11px] text-ink-3 font-mono">
        Used days stay as they are. You are setting what this person has left of each type.
      </p>
    </div>
  );
}

/** One remaining-days field on the team table. */
export function BalanceCellEditor({
  empCode,
  code,
  available,
  used,
  accrued,
}: {
  empCode: string;
  code: string;
  available: number;
  used: number;
  accrued: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(available));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) {
      setError('Must be 0 or more');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveEmployeeBalances(empCode, [{ code, available: n }]);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={() => { setValue(String(available)); setEditing(true); }}
          className="group inline-flex items-center gap-1"
          title={`Edit ${code} remaining`}
        >
          <span className={available <= 0 ? 'text-st-absent font-semibold' : 'font-bold text-ink'}>
            {available}
          </span>
          <Pencil className="size-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <span className="block text-[10px] text-ink-3 font-normal">
          {used} used / {accrued} accrued
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={0.5}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="tnum w-16 rounded-lg border border-line bg-surface-2 px-1.5 py-1 text-right text-xs text-ink"
          autoFocus
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-ink px-2 py-1 text-[10px] font-bold uppercase text-ground disabled:opacity-60"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setError(null); }}
          className="text-[10px] text-ink-3"
        >
          ✕
        </button>
      </div>
      {error && <span className="text-[10px] text-st-absent">{error}</span>}
    </div>
  );
}

export function EveryoneBalancesBar({ types }: { types: string[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(types.map((t) => [t, ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function apply() {
    setError(null);
    setOk(null);
    const items: LeaveDraft[] = types
      .map((code) => ({ code, raw: drafts[code]?.trim() }))
      .filter((x) => x.raw !== '')
      .map((x) => ({ code: x.code, available: Number(x.raw) }));
    if (items.length === 0) {
      setError('Fill at least one leave type.');
      return;
    }
    if (items.some((i) => Number.isNaN(i.available) || i.available < 0)) {
      setError('Each remaining figure must be zero or more.');
      return;
    }
    setBusy(true);
    try {
      await saveEveryoneBalances(items);
      setOk(`Set remaining days for everyone: ${items.map((i) => `${i.code} ${i.available}`).join(', ')}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl glass-panel border border-line p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Set remaining days for everyone</h2>
        <p className="mt-0.5 text-[11px] text-ink-3 font-mono">
          Applies to every active employee. Used days are kept. Leave a box empty to skip that type.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {types.map((t) => (
          <label key={t} className="text-[11px] font-mono uppercase tracking-wider text-ink-3">
            {t}
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder="—"
              value={drafts[t] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [t]: e.target.value }))}
              className="mt-1 block w-24 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wider text-ground hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Apply to all
        </button>
      </div>
      {error && <p className="text-xs text-st-absent font-mono">{error}</p>}
      {ok && <p className="text-xs text-emerald-500 font-mono">{ok}</p>}
    </div>
  );
}
