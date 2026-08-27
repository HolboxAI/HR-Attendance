import Link from 'next/link';

import { hhmm, hours, type BoardRow } from '@/lib/format';
import { Avatar } from './Avatar';
import { Status } from './Status';

export function BoardTable({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="overflow-x-auto bx-card">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
            <th className="px-4 py-3 font-medium">Employee</th>
            <th className="px-4 py-3 font-medium">Shift</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">In</th>
            <th className="px-4 py-3 font-medium">Out</th>
            <th className="px-4 py-3 font-medium">Hours</th>
            <th className="px-4 py-3 font-medium">Late</th>
            <th className="px-4 py-3 font-medium">OT</th>
            <th className="px-4 py-3 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_code} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
              <td className="px-4 py-3">
                <Link href={`/people/${r.employee_code}`} className="group flex items-center gap-3">
                  <span className="relative shrink-0">
                    <Avatar name={r.full_name} />
                    {/* Presence is a live fact and deserves its own mark,
                        separate from the day's computed status. */}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                        r.currently_in ? 'bg-accent' : 'bg-line'
                      }`}
                      aria-hidden
                    />
                  </span>
                  <span>
                    <span className="block font-medium text-ink group-hover:text-accent">
                      {r.full_name}
                      {r.currently_in && <span className="sr-only"> (currently in the office)</span>}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {r.employee_code}{r.department ? ` · ${r.department}` : ''}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="tnum px-4 py-3 text-ink-3">{r.shift_label}</td>
              <td className="px-4 py-3"><Status value={r.status} /></td>
              <td className="tnum px-4 py-3">{hhmm(r.first_in)}</td>
              <td className="tnum px-4 py-3">{hhmm(r.last_out)}</td>
              <td className="tnum px-4 py-3 font-medium">{hours(r.worked_minutes)}</td>
              <td className="tnum px-4 py-3 text-st-late">{r.late_minutes ? `${r.late_minutes}m` : '—'}</td>
              <td className="tnum px-4 py-3 text-ink-2">{r.overtime_minutes ? `${r.overtime_minutes}m` : '—'}</td>
              <td className="px-4 py-3 text-xs text-st-late">{r.exception_note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
