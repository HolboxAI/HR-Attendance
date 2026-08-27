'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Status } from '@/components/Status';
import { plainDate, proxy, type CorrectionRow, type MonthDay } from '@/lib/format';

const DIRECTION_LABEL: Record<string, string> = { in: 'Check-in', out: 'Check-out' };

/**
 * The employee's route out of a broken day: submit a claimed time and a
 * reason against a flagged shift date, watch its status, cancel while it is
 * still pending. The claimed time only becomes a punch if HR approves - the
 * form says so, because "submitted" and "fixed" are different facts.
 */
export function MyCorrections({
  rows, flaggedDays,
}: {
  rows: CorrectionRow[];
  flaggedDays: MonthDay[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shiftDate, setShiftDate] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);

  function prefill(day: MonthDay) {
    setOpen(true);
    setShiftDate(day.date);
    // A day with an in but no out wants the missing out; the reverse wants an in.
    setDirection(day.first_in && !day.last_out ? 'out' : 'in');
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!shiftDate || !time || !reason.trim()) {
      setError('Pick the day, the time you actually punched, and say why.');
      return;
    }
    setBusy(true);
    // The claimed moment is sent in IST (+05:30) because that is the wall
    // clock the person is describing - "I left at 6:30" means 6:30 at the
    // office, regardless of what timezone the server or browser runs in.
    const claimed = `${shiftDate}T${time}:00+05:30`;
    const res = await fetch(proxy('/api/v1/corrections'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_date: shiftDate, direction, claimed_at: claimed, reason: reason.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not submit - check the connection and try again.');
      return;
    }
    setOpen(false);
    setShiftDate(''); setTime(''); setReason('');
    router.refresh();
  }

  async function cancel(id: string) {
    setCancelBusy(id);
    await fetch(proxy(`/api/v1/corrections/${id}/cancel`), { method: 'POST' }).catch(() => null);
    setCancelBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {flaggedDays.length > 0 && (
        <div className="bx-card border-st-late/40 p-4">
          <h3 className="text-sm font-semibold">Days of yours that need something</h3>
          <p className="mt-1 text-xs text-ink-2">
            These days have an exception - usually a missing punch. Tap one to
            start a correction with the day filled in.
          </p>
          <ul className="mt-3 space-y-2">
            {flaggedDays.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  onClick={() => prefill(d)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="font-medium">{plainDate(d.date)}</span>
                  <span className="text-st-late">{d.exception_note ?? 'needs attention'}</span>
                  <span className="ml-auto text-xs text-accent">Request correction →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bx-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Request a correction</h3>
          {!open && (
            <button
              type="button" onClick={() => setOpen(true)}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white"
            >
              New request
            </button>
          )}
        </div>

        {open && (
          <form onSubmit={submit} className="bx-rise mt-3 space-y-3">
            <p className="text-xs text-ink-2">
              The time you claim becomes a real punch only if HR approves it.
              Until then the day stays as it is.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-ink-3">
                Which day
                <input
                  type="date" value={shiftDate} required
                  onChange={(e) => setShiftDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="block text-xs text-ink-3">
                What is missing
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
                Time it actually happened (IST)
                <input
                  type="time" value={time} required
                  onChange={(e) => setTime(e.target.value)}
                  className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
            <label className="block text-xs text-ink-3">
              Why the punch is missing - HR reads this
              <textarea
                value={reason} required rows={2}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Phone battery died before I could check out"
                className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
              />
            </label>
            {error && (
              <p role="alert" className="text-xs text-st-absent"><span aria-hidden>○ </span>{error}</p>
            )}
            <div className="flex gap-2">
              <button
                type="submit" disabled={busy}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
              <button
                type="button" onClick={() => setOpen(false)}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Your requests
        </h3>
        {rows.length === 0 ? (
          <p className="bx-card p-5 text-sm text-ink-3">
            You haven&rsquo;t asked for any corrections. When a day of yours is
            flagged, the request you submit here is how it gets fixed.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="bx-card p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{plainDate(r.shift_date)}</span>
                  <span className="text-ink-2">
                    {DIRECTION_LABEL[r.direction] ?? r.direction} at{' '}
                    {new Date(r.claimed_at).toLocaleTimeString('en-IN', {
                      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                    })}
                  </span>
                  <span className="ml-auto"><Status value={r.status} size="xs" /></span>
                </div>
                <p className="mt-1 text-xs text-ink-3">{r.reason}</p>
                {r.decided_note && (
                  <p className="mt-1 text-xs text-ink-2">
                    <span className="font-medium">HR:</span> {r.decided_note}
                  </p>
                )}
                {r.status === 'pending' && (
                  <button
                    type="button"
                    disabled={cancelBusy === r.id}
                    onClick={() => cancel(r.id)}
                    className="mt-2 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                  >
                    {cancelBusy === r.id ? 'Withdrawing…' : 'Withdraw request'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
