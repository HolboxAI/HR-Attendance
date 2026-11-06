'use client';

import { useEffect, useMemo, useState } from 'react';

import { proxy } from '@/lib/format';

type Mine = { year: number; month: number; today: string; dates: string[] };
type TeamRow = { name: string; code: string; dates: string[] };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function PlannedAbsences({ isHr }: { isHr: boolean }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [today, setToday] = useState(iso(now.getFullYear(), now.getMonth() + 1, now.getDate()));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [team, setTeam] = useState<TeamRow[] | null>(null);

  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const next = currentMonth === 12
    ? { year: currentYear + 1, month: 1 }
    : { year: currentYear, month: currentMonth + 1 };
  const canPrev = year !== currentYear || month !== currentMonth;
  const canNext = !(year === next.year && month === next.month);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSaved(false);
    fetch(proxy(`/api/v1/leave/planned-absences?year=${year}&month=${month}`))
      .then((res) => res.json())
      .then((body: Mine) => {
        if (cancelled || !body?.dates) return;
        setSelected(body.dates);
        if (body.today) setToday(body.today);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your dates.');
      });
    return () => { cancelled = true; };
  }, [year, month]);

  useEffect(() => {
    if (!isHr) return;
    fetch(proxy('/api/v1/admin/leave/planned-absences'))
      .then((res) => res.ok ? res.json() : null)
      .then((body: TeamRow[] | null) => { if (body) setTeam(body); })
      .catch(() => setTeam(null));
  }, [isHr, saved]);

  const days = useMemo(() => new Date(year, month, 0).getDate(), [year, month]);
  const lead = useMemo(() => new Date(year, month - 1, 1).getDay(), [year, month]);

  function toggle(day: string) {
    if (day < today) return;
    setSaved(false);
    setSelected((cur) => cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort());
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(proxy('/api/v1/leave/planned-absences'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          month,
          dates: selected.filter((d) => d >= today && d.startsWith(`${year}-${String(month).padStart(2, '0')}`)),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === 'string' ? body.detail : 'Could not save');
        return;
      }
      setSelected(body.dates ?? selected);
      setSaved(true);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line glass-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
            Advance availability notice
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-2">
            Mark dates you expect to be away. This is a notice, not leave — it does not use your leave balance.
            If you come in anyway, your punch still counts. Past dates stay as you left them.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => { setYear(currentYear); setMonth(currentMonth); }}
            className="rounded-lg border border-line px-2 py-1 disabled:opacity-30"
          >
            ‹
          </button>
          <span>{MONTHS[month - 1]} {year}</span>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => { setYear(next.year); setMonth(next.month); }}
            className="rounded-lg border border-line px-2 py-1 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-mono text-ink-3">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d}>{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = iso(year, month, i + 1);
          const on = selected.includes(day);
          const locked = day < today;
          return (
            <button
              key={day}
              type="button"
              disabled={locked}
              onClick={() => toggle(day)}
              className={`rounded-lg py-2 text-sm ${
                on
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  : 'border border-transparent hover:border-line'
              } ${locked ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-xl bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save these dates'}
        </button>
        {saved && <span className="text-xs text-emerald-300">Saved. Admins see this at 11:59 PM.</span>}
      </div>

      {isHr && team && (
        <div className="space-y-2 border-t border-line pt-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
            Everyone, from today
          </h3>
          <ul className="space-y-1 text-sm">
            {team.map((row) => (
              <li key={row.code} className="flex justify-between gap-4">
                <span>{row.name} <span className="font-mono text-ink-3">({row.code})</span></span>
                <span className="text-ink-2">{row.dates.length ? row.dates.join(', ') : '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
