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

async function putMonthlyMax(path: string, monthly_leave_max: number | null, note?: string) {
  const res = await fetch(proxy(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      monthly_leave_max,
      ...(note ? { note } : {}),
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

export function saveEmployeeMonthlyMax(empCode: string, monthly_leave_max: number | null) {
  return putMonthlyMax(
    `/api/v1/admin/leave/balances/${encodeURIComponent(empCode)}/monthly-max`,
    monthly_leave_max,
  );
}

export function saveEveryoneMonthlyMax(monthly_leave_max: number | null) {
  return putMonthlyMax('/api/v1/admin/leave/balances/monthly-max/all', monthly_leave_max);
}

export async function saveEmployeeMonthCredit(
  empCode: string,
  code: string,
  year: number,
  month: number,
  amount: number,
) {
  const res = await fetch(
    proxy(`/api/v1/admin/leave/balances/${encodeURIComponent(empCode)}/month-credit`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, year, month, amount }),
    },
  ).catch(() => null);
  if (!res) throw new Error('Could not reach the API');
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === 'string' ? detail : `Save failed (${res.status})`);
  }
  return res.json();
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

/** Edit one month's accrual credit (capped server-side at quota/12). */
export function MonthCreditCellEditor({
  empCode,
  code,
  year,
  month,
  credit,
  cap,
  available,
}: {
  empCode: string;
  code: string;
  year: number;
  month: number;
  credit: number;
  cap: number;
  available: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(credit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0 || n > cap) {
      setError(`Must be 0–${cap}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveEmployeeMonthCredit(empCode, code, year, month, n);
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
          onClick={() => { setValue(String(credit)); setEditing(true); }}
          className="group inline-flex items-center gap-1"
          title={`Edit ${code} credit for ${year}-${month} (max ${cap})`}
        >
          <span className="font-bold text-ink">{credit}</span>
          <Pencil className="size-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <span className="block text-[10px] text-ink-3 font-normal">
          max {cap} · year left {available}
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
          max={cap}
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

/** Pencil editor for one person's monthly leave max. Empty = clear (no cap). */
export function MonthlyMaxCellEditor({
  empCode,
  monthlyLeaveMax,
}: {
  empCode: string;
  monthlyLeaveMax: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    monthlyLeaveMax == null ? '' : String(monthlyLeaveMax),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const raw = value.trim();
    let next: number | null;
    if (raw === '') {
      next = null;
    } else {
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > 31) {
        setError('0–31, or empty for no max');
        return;
      }
      next = n;
    }
    setBusy(true);
    setError(null);
    try {
      await saveEmployeeMonthlyMax(empCode, next);
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
      <button
        type="button"
        onClick={() => {
          setValue(monthlyLeaveMax == null ? '' : String(monthlyLeaveMax));
          setEditing(true);
        }}
        className="group inline-flex items-center gap-1"
        title="Edit monthly leave max"
      >
        <span className="font-bold text-ink tnum">
          {monthlyLeaveMax == null ? '—' : monthlyLeaveMax}
        </span>
        <Pencil className="size-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={31}
          step={0.5}
          placeholder="none"
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
  const [monthlyMaxDraft, setMonthlyMaxDraft] = useState('');
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
    const maxRaw = monthlyMaxDraft.trim();
    const applyMax = maxRaw !== '';
    let monthlyMax: number | null = null;
    if (applyMax) {
      if (maxRaw.toLowerCase() === 'none' || maxRaw === '-') {
        monthlyMax = null;
      } else {
        const n = Number(maxRaw);
        if (Number.isNaN(n) || n < 0 || n > 31) {
          setError('Monthly max must be 0–31, or type none to clear.');
          return;
        }
        monthlyMax = n;
      }
    }
    if (items.length === 0 && !applyMax) {
      setError('Fill at least one leave type, or a monthly max.');
      return;
    }
    if (items.some((i) => Number.isNaN(i.available) || i.available < 0)) {
      setError('Each remaining figure must be zero or more.');
      return;
    }
    setBusy(true);
    try {
      const parts: string[] = [];
      if (items.length > 0) {
        await saveEveryoneBalances(items);
        parts.push(items.map((i) => `${i.code} ${i.available}`).join(', '));
      }
      if (applyMax) {
        await saveEveryoneMonthlyMax(monthlyMax);
        parts.push(
          monthlyMax == null
            ? 'monthly max cleared'
            : `monthly max ${monthlyMax}`,
        );
      }
      setOk(`Applied to everyone: ${parts.join('; ')}.`);
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
        <h2 className="text-sm font-semibold text-ink">Set for everyone</h2>
        <p className="mt-0.5 text-[11px] text-ink-3 font-mono">
          Remaining days and/or monthly leave max for every active employee. Leave a box empty to skip it. Type <span className="text-ink">none</span> in monthly max to remove the cap.
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
        <label className="text-[11px] font-mono uppercase tracking-wider text-ink-3">
          Max / month
          <input
            type="text"
            inputMode="decimal"
            placeholder="—"
            value={monthlyMaxDraft}
            onChange={(e) => setMonthlyMaxDraft(e.target.value)}
            className="mt-1 block w-24 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink"
          />
        </label>
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
