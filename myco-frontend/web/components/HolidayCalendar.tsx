'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';

import { plainDate, proxy, type HolidayRow } from '@/lib/format';

/**
 * Adding or removing a holiday recomputes the affected dates on the server
 * before it returns, so the board never disagrees with this calendar.
 *
 * The list reads like a person plans: what is COMING, from today forward.
 * January's holidays in September are trivia, not information, so past dates
 * leave the table and live in the year-at-a-glance calendar below it -
 * collapsed behind a labelled control, expanded on tap, dismissed by simply
 * moving the cursor away.
 */
export function HolidayCalendar({
  rows, canEdit, year,
}: {
  rows: HolidayRow[];
  canEdit: boolean;
  year: number;
}) {
  const router = useRouter();
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [optional, setOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // "Today" in the org's timezone, as the same YYYY-MM-DD shape the rows
  // use, so string comparison is date comparison. UTC would call it
  // yesterday between midnight and 05:30 IST - the board's old bug.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const upcoming = sorted.filter((r) => r.day >= today);
  const past = sorted.filter((r) => r.day < today);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(proxy('/api/v1/admin/holidays'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, name, is_optional: optional }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not add that holiday');
      return;
    }
    const addedDay = day;
    const addedName = name;
    setDay('');
    setName('');
    setOptional(false);
    setSuccess(`Successfully added holiday on ${addedDay} reason: ${addedName}`);
    setTimeout(() => setSuccess(null), 2000);
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(proxy(`/api/v1/admin/holidays/${id}`), { method: 'DELETE' })
      .catch(() => null);
    setBusy(false);
    router.refresh();
  }

  const unconfirmed = rows.filter((r) => !r.is_confirmed).length;

  return (
    <div className="space-y-4">
      {unconfirmed > 0 && (
        <p className="rounded-2xl border border-line glass-panel p-5 text-xs text-ink-2 font-mono">
          <strong className="text-ink">{unconfirmed} dates need confirming.</strong>{' '}
          Lunar-calendar festivals move every year and are fixed by Gujarat government notification.
        </p>
      )}

      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3.5 rounded-2xl glass-panel border border-line p-5">
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">Date</span>
            <input
              type="date" required value={day} onChange={(e) => setDay(e.target.value)}
              className="rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">Name</span>
            <input
              required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Diwali"
              className="rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </label>
          <label className="flex items-center gap-2 py-2 text-xs font-medium text-ink-2 cursor-pointer">
            <input
              type="checkbox" checked={optional}
              onChange={(e) => setOptional(e.target.checked)} className="size-4 rounded border-line"
            />
            Optional (office stays open)
          </label>
          <button
            type="submit" disabled={busy}
            className="rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all cursor-pointer"
          >
            {busy ? 'Saving…' : 'Add holiday'}
          </button>
          {error && (
            <p role="alert" className="w-full text-xs text-st-absent font-mono">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="w-full text-xs text-accent font-mono font-medium">
              {success}
            </p>
          )}
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Holiday</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Confirmed</th>
              {canEdit && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody
            onMouseLeave={() => setHoveredId(null)}
          >
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="px-4 py-6 text-ink-3 font-mono">
                  {rows.length === 0
                    ? `No holidays recorded for ${year}.`
                    : `No holidays left this year - all ${rows.length} have passed. They are in the calendar below.`}
                </td>
              </tr>
            )}
            {upcoming.map((r) => {
              const isHovered = hoveredId === r.id;
              const isDimmed = hoveredId !== null && !isHovered;
              return (
                <tr
                  key={r.id}
                  onMouseEnter={() => setHoveredId(r.id)}
                  className={`border-b border-line/60 last:border-0 transition-all duration-300 ${
                    isHovered ? 'bg-surface-2/60' : 'hover:bg-surface-2/30'
                  } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
                >
                  <td className="tnum whitespace-nowrap px-4 py-3 font-mono">
                    <span className="transition-transform duration-300 inline-block group-hover:translate-x-1">{plainDate(r.day)}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                  <td className="px-4 py-3 text-ink-3 font-mono">
                    {r.is_optional ? 'Optional' : 'Office closed'}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {r.is_confirmed ? (
                      <span className="text-ink font-semibold">Confirmed</span>
                    ) : (
                      <span className="text-ink-3">Check date</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <button
                        type="button" disabled={busy} onClick={() => remove(r.id)}
                        className="rounded-xl border border-line glass-panel px-3 py-1.5 text-xs font-mono font-semibold text-ink hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The year at a glance. Collapsed by default behind a labelled
          control; tap expands it, and moving the cursor off the box closes
          it again - a reference you glance at, not a panel you manage. */}
      <div onMouseLeave={() => setCalendarOpen(false)}>
        <button
          type="button"
          onClick={() => setCalendarOpen((o) => !o)}
          aria-expanded={calendarOpen}
          className="flex w-full items-center justify-between gap-3 rounded-2xl glass-panel border border-line px-5 py-4 text-left hover:bg-surface-2/60 transition-all cursor-pointer"
        >
          <span className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 border border-line text-ink-2">
              <CalendarDays className="size-4" aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink">
                {year} at a glance
              </span>
              <span className="block text-xs text-ink-3 font-mono">
                {past.length > 0
                  ? `The list above starts from today - the ${past.length} holiday${past.length === 1 ? ' that has' : 's that have'} already passed ${past.length === 1 ? 'is' : 'are'} in here, month by month.`
                  : 'Every holiday of the year, month by month.'}
              </span>
            </span>
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-ink-3 transition-transform duration-300 ${calendarOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        {calendarOpen && (
          <div className="mt-3 rounded-2xl glass-panel border border-line p-5 fade-in-up">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, m) => (
                <MonthGrid key={m} year={year} month={m} rows={sorted} today={today} />
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-3 text-[10px] font-mono text-ink-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-flex size-4 items-center justify-center rounded bg-ink text-ground font-bold">1</span>
                Office closed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex size-4 items-center justify-center rounded border border-ink font-bold text-ink">1</span>
                Optional
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex size-4 items-center justify-center rounded ring-1 ring-accent text-ink">1</span>
                Today
              </span>
              <span>* date awaiting confirmation</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * One month of the year-at-a-glance: a real weekday-aligned grid with
 * holiday dates emphasised, and each holiday named right under its month -
 * a bold date with no word saying why would just be a puzzle.
 */
function MonthGrid({
  year, month, rows, today,
}: {
  year: number;
  month: number; // 0-11
  rows: HolidayRow[];
  today: string;
}) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const holidays = rows.filter((r) => r.day.startsWith(prefix));
  const byDay = new Map(holidays.map((r) => [r.day, r]));

  // UTC on purpose: these are calendar dates, not instants, and building
  // them in the browser's local zone would shift the weekday for anyone
  // whose machine is not on IST.
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
        {MONTH_NAMES[month]}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={`${d}-${i}`} className="text-[9px] font-mono text-ink-3/70">{d}</span>
        ))}
        {Array.from({ length: firstDow }, (_, i) => <span key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${prefix}${String(i + 1).padStart(2, '0')}`;
          const holiday = byDay.get(date);
          const isToday = date === today;
          return (
            <span
              key={date}
              title={holiday ? holiday.name : undefined}
              className={`inline-flex size-5 items-center justify-center rounded text-[10px] font-mono ${
                holiday
                  ? holiday.is_optional
                    ? 'border border-ink font-bold text-ink'
                    : 'bg-ink font-bold text-ground'
                  : 'text-ink-3'
              } ${isToday ? 'ring-1 ring-accent' : ''}`}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
      {holidays.length > 0 && (
        <ul className="space-y-0.5">
          {holidays.map((r) => (
            <li key={r.id} className="text-[10px] font-mono text-ink-2 leading-snug">
              <span className="tnum font-semibold text-ink">{Number(r.day.slice(8, 10))}</span>
              {' · '}{r.name}
              {!r.is_confirmed && <span title="Date awaiting confirmation"> *</span>}
              {r.is_optional && <span className="text-ink-3"> (optional)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
