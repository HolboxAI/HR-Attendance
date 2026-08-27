'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { plainDate, proxy, type HolidayRow } from '@/lib/format';

/**
 * Adding or removing a holiday recomputes the affected dates on the server
 * before it returns, so the board never disagrees with this calendar.
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
    setDay('');
    setName('');
    setOptional(false);
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="px-4 py-6 text-ink-3 font-mono">
                  No holidays recorded for {year}.
                </td>
              </tr>
            )}
            {rows.map((r) => {
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
    </div>
  );
}
