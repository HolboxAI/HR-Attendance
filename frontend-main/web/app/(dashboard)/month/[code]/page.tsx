import Link from 'next/link';

import { statusGlyph, statusLabel } from '@/components/Status';
import { getMonth, hhmm, hours } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function MonthPage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { code } = await params;
  const { y, m } = await searchParams;
  const now = new Date();
  const year = Number(y) || now.getUTCFullYear();
  const month = Number(m) || now.getUTCMonth() + 1;

  const data = await getMonth(code, year, month);
  if (!data) {
    return <p className="text-st-absent">Couldn&apos;t load {code} — is the API running?</p>;
  }

  const label = new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/people/${code}`} className="text-sm text-accent">← Back to profile</Link>
        <h1
          className="mt-2 font-display text-3xl font-bold tracking-tight"
        >
          {data.full_name}
        </h1>
        <p className="text-sm text-ink-3">{code} · {label}</p>
        <p className="mt-1 flex gap-3 text-xs">
          <Link href={`/month/${code}?y=${month === 1 ? year - 1 : year}&m=${month === 1 ? 12 : month - 1}`} className="text-accent hover:underline">← Previous month</Link>
          <Link href={`/month/${code}?y=${month === 12 ? year + 1 : year}&m=${month === 12 ? 1 : month + 1}`} className="text-accent hover:underline">Next month →</Link>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Days present', value: String(data.totals.present ?? 0), tone: 'text-st-present' },
          { label: 'Half days', value: String(data.totals.half_day ?? 0), tone: 'text-st-half' },
          { label: 'Absent', value: String(data.totals.absent ?? 0), tone: 'text-st-absent' },
          { label: 'Hours worked', value: hours(data.totals.worked_minutes ?? 0), tone: 'text-accent' },
        ].map((t) => (
          <div key={t.label} className="bx-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-widest text-ink-3">{t.label}</div>
            <div className={`tnum mt-1 text-2xl font-bold ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto bx-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">In</th>
              <th className="px-4 py-3 font-medium">Out</th>
              <th className="px-4 py-3 font-medium">Hours</th>
              <th className="px-4 py-3 font-medium">Late</th>
              <th className="px-4 py-3 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map((d) => {
              const off = d.status === 'weekly_off' || d.status === 'holiday';
              return (
                <tr
                  key={d.date}
                  className={`border-b border-line/60 last:border-0 ${off ? 'opacity-45' : ''}`}
                >
                  <td className="tnum px-4 py-2.5 whitespace-nowrap">
                    {d.date.slice(8)} <span className="text-ink-3">{d.weekday}</span>
                  </td>
                  {/* glyph + word: never colour alone */}
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="text-ink-3" aria-hidden>{statusGlyph(d.status)}</span>{' '}
                    {statusLabel(d.status)}
                  </td>
                  <td className="tnum px-4 py-2.5">{hhmm(d.first_in)}</td>
                  <td className="tnum px-4 py-2.5">{hhmm(d.last_out)}</td>
                  <td className="tnum px-4 py-2.5">{hours(d.worked_minutes)}</td>
                  <td className="tnum px-4 py-2.5 text-st-late">
                    {d.late_minutes ? `${d.late_minutes}m` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-st-late">{d.exception_note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
