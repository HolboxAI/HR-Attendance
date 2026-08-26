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
  if (!data) {
    return (
      <div className="rounded border border-st-absent/50 bg-surface p-6">
        <h2 className="text-lg font-semibold">Could not load your attendance</h2>
        <p className="mt-2 text-sm text-ink-2">Try signing out and back in.</p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // Future dates are not "absent", they simply have not happened.
  const days = data.days.filter((d) => d.date <= today);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {name ?? data.full_name}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Your attendance this month. Check in and out from the Boxcode app on your phone.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">Hours worked</div>
          <div className="tnum mt-1 font-display text-2xl font-bold">
            {hours(data.totals.worked_minutes)}
          </div>
        </div>
        <div className="rounded border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">Days present</div>
          <div className="tnum mt-1 font-display text-2xl font-bold">
            {data.totals.present ?? 0}
          </div>
        </div>
        <div className="rounded border border-line bg-surface p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">Late by</div>
          <div className="tnum mt-1 font-display text-2xl font-bold">
            {hours(data.totals.late_minutes)}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
          Day by day
        </h2>
        <div className="overflow-x-auto rounded border border-line bg-surface">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">In</th>
                <th className="px-4 py-3 font-medium">Out</th>
                <th className="px-4 py-3 font-medium">Worked</th>
                <th className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-line/60 last:border-0">
                  <td className="tnum px-4 py-3">
                    <span className="text-ink-3">{d.weekday}</span>{' '}
                    {d.date.slice(8)}/{d.date.slice(5, 7)}
                  </td>
                  {/* Glyph + word, matching the month page. No colour-only status. */}
                  <td className="px-4 py-3">
                    <span className="text-ink-3" aria-hidden>{statusGlyph(d.status)}</span>{' '}
                    {statusLabel(d.status)}
                  </td>
                  <td className="tnum px-4 py-3 text-ink-2">{hhmm(d.first_in)}</td>
                  <td className="tnum px-4 py-3 text-ink-2">{hhmm(d.last_out)}</td>
                  <td className="tnum px-4 py-3">{hours(d.worked_minutes)}</td>
                  <td className="px-4 py-3 text-st-late">{d.exception_note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
