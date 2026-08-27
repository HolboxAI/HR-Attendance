'use client';

import { useState } from 'react';
import { statusGlyph, statusLabel } from '@/components/Status';
import { hhmm, hours, type MonthDay } from '@/lib/format';

type Data = {
  employee_code: string;
  full_name: string;
  days: MonthDay[];
  totals: Record<string, number>;
} | null;

/**
 * What a non-admin sees on the dashboard: their own month.
 *
 * Everyone with an employee record can look at their own attendance - that is
 * not an administrative privilege, and five of the seven people here have no
 * other reason to open this site.
 */
export function MyMonth({ data, name }: { data: Data; name: string | null }) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  if (!data) {
    return (
      <div className="rounded-2xl border border-st-absent/50 glass-panel p-6">
        <h2 className="text-lg font-semibold text-st-absent">Could not load your attendance</h2>
        <p className="mt-2 text-sm text-ink-2 font-mono">Try signing out and back in.</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // Future dates are not "absent", they simply have not happened.
  const days = data.days.filter((d) => d.date <= today);

  return (
    <div className="space-y-8 fade-in-up">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
          {name ?? data.full_name}
        </h1>
        <p className="mt-1 text-sm text-ink-3 font-mono">
          Your attendance this month. Recorded live via biometric mobile check-in.
        </p>
      </div>

      <section className="grid gap-3.5 sm:grid-cols-3">
        <div className="glass-panel rounded-2xl p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-3">Hours worked</div>
          <div className="tnum mt-2 font-display text-3xl font-extrabold text-ink">
            {hours(data.totals.worked_minutes)}
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-3">Days present</div>
          <div className="tnum mt-2 font-display text-3xl font-extrabold text-ink">
            {data.totals.present ?? 0}
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-3">Late by</div>
          <div className="tnum mt-2 font-display text-3xl font-extrabold text-ink">
            {hours(data.totals.late_minutes)}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
          Day-by-Day Attendance Log
        </h2>
        <div className="overflow-x-auto glass-panel rounded-2xl">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
                <th className="px-5 py-3.5 font-semibold">Date</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 font-semibold">In</th>
                <th className="px-5 py-3.5 font-semibold">Out</th>
                <th className="px-5 py-3.5 font-semibold">Worked</th>
                <th className="px-5 py-3.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody
              onMouseLeave={() => setHoveredDate(null)}
              className="divide-y divide-line/30"
            >
              {days.map((d) => {
                const isHovered = hoveredDate === d.date;
                const isDimmed = hoveredDate !== null && !isHovered;
                return (
                  <tr
                    key={d.date}
                    onMouseEnter={() => setHoveredDate(d.date)}
                    className={`group cursor-pointer transition-all duration-300 ${
                      isHovered ? 'bg-surface-2/70' : 'hover:bg-surface-2/40'
                    } ${isDimmed ? 'opacity-30' : 'opacity-100'}`}
                  >
                    <td className="tnum px-5 py-3.5 font-mono text-xs text-ink">
                      <span className="transition-transform duration-300 inline-block group-hover:translate-x-2.5">
                        <span className="text-ink-3 font-medium">{d.weekday}</span>{' '}
                        {d.date.slice(8)}/{d.date.slice(5, 7)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-ink-3 mr-1.5" aria-hidden>{statusGlyph(d.status)}</span>{' '}
                      <span className="text-xs font-mono font-medium">{statusLabel(d.status)}</span>
                    </td>
                    <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-2">{hhmm(d.first_in)}</td>
                    <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-2">{hhmm(d.last_out)}</td>
                    <td className="tnum px-5 py-3.5 font-mono text-xs font-semibold text-ink">{hours(d.worked_minutes)}</td>
                    <td className="px-5 py-3.5 text-xs font-mono text-st-late">{d.exception_note ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
