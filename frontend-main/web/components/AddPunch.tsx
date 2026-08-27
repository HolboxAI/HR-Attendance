'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { proxy, type CorrectResult } from '@/lib/format';

type EmployeeOption = { code: string; name: string };

/**
 * HR adding a punch directly - the phone-call path, clearly separated from
 * the employee-submitted request queue. POST /admin/correct creates a new
 * MANUAL punch carrying who asked and why; it never edits anything, and the
 * day is recomputed server-side from the fuller set of facts.
 *
 * The confirm step exists because this action changes someone's attendance
 * with no second approver - the same trade the endpoint has always made.
 */
export function AddPunch({ employees }: { employees: EmployeeOption[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CorrectResult | null>(null);

  const ready = code && shiftDate && time && reason.trim();
  const who = employees.find((e) => e.code === code)?.name ?? code;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch(proxy('/api/v1/admin/correct'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_code: code,
        shift_date: shiftDate,
        // IST wall clock - the time HR is reading off the phone call.
        at: `${shiftDate}T${time}:00+05:30`,
        direction,
        reason: reason.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not add the punch.');
      return;
    }
    setResult((await res.json()) as CorrectResult);
    setReason(''); setTime('');
    router.refresh();
  }

  return (
    <div className="bx-card p-4">
      <h3 className="text-sm font-semibold">Add a punch directly</h3>
      <p className="mt-1 text-xs text-ink-2">
        For a phone call or a backfill. This creates a new manual punch under
        your name and recomputes the day - the original events are never edited.
        Prefer the request queue above when the employee can submit it themselves:
        there, asker and decider are different people.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (ready) setConfirming(true); }}
        className="mt-3 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs text-ink-3">
            Employee
            <select
              value={code} required onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
            >
              <option value="" disabled>Choose…</option>
              {employees.map((e) => (
                <option key={e.code} value={e.code}>{e.name} · {e.code}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-ink-3">
            Shift date
            <input
              type="date" value={shiftDate} required
              onChange={(e) => setShiftDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="block text-xs text-ink-3">
            Direction
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
              className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
            >
              <option value="in">Check-in</option>
              <option value="out">Check-out</option>
            </select>
          </label>
          <label className="block text-xs text-ink-3">
            Time (IST)
            <input
              type="time" value={time} required onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
            />
          </label>
        </div>
        <label className="block text-xs text-ink-3">
          Reason - lands in the audit trail with your name
          <input
            value={reason} required onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Called at 9:05 - app crashed at the gate"
            className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-st-absent"><span aria-hidden>○ </span>{error}</p>
        )}
        {result && (
          <p className="rounded-md bg-st-present/10 px-3 py-2 text-xs text-st-present" role="status">
            <span aria-hidden>● </span>
            {result.created
              ? `Punch added. ${result.shift_date} now resolves to "${result.status.replace('_', ' ')}"${result.has_exception ? ', still flagged' : ''}.`
              : result.note ?? 'That punch already existed - nothing changed.'}
          </p>
        )}
        <button
          type="submit" disabled={!ready || busy}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Review &amp; add punch
        </button>
      </form>

      <ConfirmDialog
        open={confirming}
        title={`Add a ${direction === 'in' ? 'check-in' : 'check-out'} for ${who}?`}
        consequence={`This creates a real punch at ${time} IST on ${shiftDate} and recomputes that day's attendance immediately. It is recorded under your name with the reason you gave.`}
        confirmLabel="Add punch"
        busy={busy}
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
