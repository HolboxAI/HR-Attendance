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
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoveredReqId, setHoveredReqId] = useState<string | null>(null);

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
        <div className="rounded-2xl glass-panel border border-line p-5">
          <h3 className="text-sm font-bold text-ink">Days of yours that need attention</h3>
          <p className="mt-1 text-xs font-mono text-ink-3">
            These days have an exception (e.g. missing punch). Tap one to pre-fill a correction.
          </p>
          <ul
            onMouseLeave={() => setHoveredDate(null)}
            className="mt-4 space-y-2"
          >
            {flaggedDays.map((d) => {
              const isHovered = hoveredDate === d.date;
              const isDimmed = hoveredDate !== null && !isHovered;
              return (
                <li key={d.date}>
                  <button
                    type="button"
                    onClick={() => prefill(d)}
                    onMouseEnter={() => setHoveredDate(d.date)}
                    className={`flex w-full flex-wrap items-baseline gap-x-3 rounded-xl border border-line/60 glass-panel px-4 py-2.5 text-left text-xs transition-all duration-300 cursor-pointer ${
                      isHovered ? 'bg-surface-2/70 scale-[1.01]' : 'hover:bg-surface-2'
                    } ${isDimmed ? 'opacity-40 scale-[0.99]' : 'opacity-100'}`}
                  >
                    <span className="font-semibold text-ink font-mono transition-transform duration-300 group-hover:translate-x-1">{plainDate(d.date)}</span>
                    <span className="text-ink-3 font-mono">{d.exception_note ?? 'needs attention'}</span>
                    <span className="ml-auto text-xs font-bold text-ink font-mono">Request correction →</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-2xl glass-panel border border-line p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Request a correction</h3>
          {!open && (
            <button
              type="button" onClick={() => setOpen(true)}
              className="rounded-xl bg-ink text-ground px-4 py-2 text-xs font-black uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              New request
            </button>
          )}
        </div>

        {open && (
          <form onSubmit={submit} className="bx-rise mt-4 space-y-4">
            <p className="text-xs font-mono text-ink-3">
              The time you claim becomes a real punch only if HR approves it. Until then the day stays as it is.
            </p>
            <div className="grid gap-3.5 sm:grid-cols-3">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                Which day
                <input
                  type="date" value={shiftDate} required
                  onChange={(e) => setShiftDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </label>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                What is missing
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
                  className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
                >
                  <option value="in">Check-in</option>
                  <option value="out">Check-out</option>
                </select>
              </label>
              <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                Time it actually happened (IST)
                <input
                  type="time" value={time} required
                  onChange={(e) => setTime(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink font-mono"
                />
              </label>
            </div>
            <label className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              Why the punch is missing - HR reads this
              <textarea
                value={reason} required rows={2}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Phone battery died before I could check out"
                className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </label>
            {error && (
              <p role="alert" className="text-xs text-st-absent font-mono">{error}</p>
            )}
            <div className="flex gap-2.5">
              <button
                type="submit" disabled={busy}
                className="rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
              >
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
              <button
                type="button" onClick={() => setOpen(false)}
                className="rounded-xl border border-line px-4 py-2 text-xs font-mono font-semibold text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Your requests
        </h3>
        {rows.length === 0 ? (
          <p className="rounded-2xl glass-panel border border-line p-5 text-xs font-mono text-ink-3">
            You haven&rsquo;t asked for any corrections. When a day of yours is flagged, the request you submit here is how it gets fixed.
          </p>
        ) : (
          <div
            onMouseLeave={() => setHoveredReqId(null)}
            className="space-y-2.5"
          >
            {rows.map((r) => {
              const isHovered = hoveredReqId === r.id;
              const isDimmed = hoveredReqId !== null && !isHovered;
              return (
                <div
                  key={r.id}
                  onMouseEnter={() => setHoveredReqId(r.id)}
                  className={`rounded-2xl glass-panel border border-line p-5 transition-all duration-300 ${
                    isHovered ? 'bg-surface-2/60 scale-[1.01]' : 'hover:bg-surface-2/40'
                  } ${isDimmed ? 'opacity-40 scale-[0.99]' : 'opacity-100'}`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span className="font-semibold text-ink font-mono transition-transform duration-300 group-hover:translate-x-1">{plainDate(r.shift_date)}</span>
                    <span className="text-ink-2 font-mono">
                      {DIRECTION_LABEL[r.direction] ?? r.direction} at{' '}
                      {new Date(r.claimed_at).toLocaleTimeString('en-IN', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                      })}
                    </span>
                    <span className="ml-auto"><Status value={r.status} size="xs" /></span>
                  </div>
                  <p className="mt-2 text-xs font-mono text-ink-3">{r.reason}</p>
                  {r.decided_note && (
                    <p className="mt-1.5 text-xs text-ink-2 font-mono">
                      <span className="font-bold text-ink">HR:</span> {r.decided_note}
                    </p>
                  )}
                  {r.status === 'pending' && (
                    <button
                      type="button"
                      disabled={cancelBusy === r.id}
                      onClick={() => cancel(r.id)}
                      className="mt-3 rounded-xl border border-line px-3.5 py-1.5 text-xs font-mono font-semibold text-ink hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {cancelBusy === r.id ? 'Withdrawing…' : 'Withdraw request'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
