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
        <p className="rounded border border-st-late/40 bg-surface p-4 text-sm text-ink-2">
          <span className="text-st-late" aria-hidden>◐ </span>
          <strong className="text-st-late">{unconfirmed} dates need confirming.</strong>{' '}
          Lunar-calendar festivals move every year and are fixed by Gujarat government
          notification. These were seeded from a best estimate — check them against the
          official list, because a wrong holiday marks the whole company off on the
          wrong day.
        </p>
      )}

      {canEdit && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3 bx-card p-4">
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">Date</span>
            <input
              type="date" required value={day} onChange={(e) => setDay(e.target.value)}
              className="rounded border border-line bg-surface-2 px-3 py-1.5 text-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-widest text-ink-3">Name</span>
            <input
              required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Diwali"
              className="rounded border border-line bg-surface-2 px-3 py-1.5 text-ink"
            />
          </label>
          <label className="flex items-center gap-2 py-2 text-sm text-ink-2">
            <input
              type="checkbox" checked={optional}
              onChange={(e) => setOptional(e.target.checked)} className="h-4 w-4"
            />
            Optional (office stays open)
          </label>
          <button
            type="submit" disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Add holiday'}
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-st-absent">
              <span aria-hidden>○ </span>{error}
            </p>
          )}
        </form>
      )}

      <div className="overflow-x-auto bx-card">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Holiday</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Confirmed</th>
              {canEdit && <th className="px-4 py-3 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="px-4 py-6 text-ink-3">
                  No holidays recorded for {year}.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="tnum whitespace-nowrap px-4 py-3">{plainDate(r.day)}</td>
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 text-ink-3">
                  {r.is_optional ? 'Optional' : 'Office closed'}
                </td>
                <td className="px-4 py-3">
                  {r.is_confirmed ? (
                    <span className="text-st-present">
                      <span aria-hidden>● </span>Confirmed
                    </span>
                  ) : (
                    <span className="text-st-late">
                      <span aria-hidden>◐ </span>Check date
                    </span>
                  )}
                </td>
                {canEdit && (
                  <td className="px-4 py-3">
                    <button
                      type="button" disabled={busy} onClick={() => remove(r.id)}
                      className="rounded border border-line px-2 py-1 text-xs text-ink-2 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
