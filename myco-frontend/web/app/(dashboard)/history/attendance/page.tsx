import { redirect } from 'next/navigation';
import { format, startOfMonth, parseISO } from 'date-fns';
import { History } from 'lucide-react';
import Link from 'next/link';

import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity, apiGet } from '@/lib/session';
import { dayMonth, hhmm } from '@/lib/format';
import { HoverProfile } from '@/components/HoverProfile';
import { Status } from '@/components/Status';

export const dynamic = 'force-dynamic';

export default async function AttendanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; employee?: string; status?: string; late?: string; regularized?: string; exception?: string }>;
}) {
  const sp = await searchParams;
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  if (!caps.canViewBoard) redirect('/');

  // Default to current month if no range provided
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const monthStartStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const end = sp?.end || todayStr;
  const start = sp?.start || monthStartStr;

  let url = `/api/v1/admin/history/attendance?start_date=${start}&end_date=${end}`;
  if (sp?.employee) url += `&employee_code=${encodeURIComponent(sp.employee)}`;
  if (sp?.status) url += `&status=${encodeURIComponent(sp.status)}`;

  const rows: any[] = (await apiGet<any[]>(url)) ?? [];

  // Client-side filtering for attributes we didn't pass to backend
  let filteredRows = rows;
  if (sp?.late === 'true') filteredRows = filteredRows.filter(r => r.late_minutes > 0);
  if (sp?.regularized === 'true') filteredRows = filteredRows.filter(r => r.is_regularized);
  if (sp?.exception === 'true') filteredRows = filteredRows.filter(r => r.has_exception);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
            <History className="size-6 text-ink-3" />
            Attendance History
          </h1>
          <p className="text-sm text-ink-3 font-mono mt-1">
            Detailed daily records for all employees.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/history" className="text-xs font-mono font-semibold text-ink-2 hover:text-ink transition-colors mr-2">
            ← Overview
          </Link>
          <div className="flex items-center gap-1 bg-surface-2/60 border border-line rounded-xl p-1 text-[11px] font-mono">
            <Link
              href={`/history/attendance?start=${todayStr}&end=${todayStr}${sp?.employee ? `&employee=${sp.employee}` : ''}${sp?.status ? `&status=${sp.status}` : ''}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${start === todayStr && end === todayStr ? 'bg-surface text-ink font-bold shadow-xs' : 'text-ink-3 hover:text-ink'}`}
            >
              Today
            </Link>
            <Link
              href={`/history/attendance?start=${monthStartStr}&end=${todayStr}${sp?.employee ? `&employee=${sp.employee}` : ''}${sp?.status ? `&status=${sp.status}` : ''}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${start === monthStartStr && end === todayStr ? 'bg-surface text-ink font-bold shadow-xs' : 'text-ink-3 hover:text-ink'}`}
            >
              This Month
            </Link>
          </div>
          <form action="/history/attendance" method="GET" className="flex items-center gap-2 text-xs font-mono">
            {sp?.employee && <input type="hidden" name="employee" value={sp.employee} />}
            {sp?.status && <input type="hidden" name="status" value={sp.status} />}
            {sp?.late && <input type="hidden" name="late" value={sp.late} />}
            {sp?.regularized && <input type="hidden" name="regularized" value={sp.regularized} />}
            {sp?.exception && <input type="hidden" name="exception" value={sp.exception} />}
            <input
              id="start"
              name="start"
              type="date"
              defaultValue={start}
              aria-label="From date"
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs bg-transparent"
            />
            <span className="text-ink-3">to</span>
            <input
              id="end"
              name="end"
              type="date"
              defaultValue={end}
              aria-label="To date"
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs bg-transparent"
            />
            <button type="submit" className="rounded-xl bg-ink text-ground px-3.5 py-1.5 font-bold uppercase tracking-wider shadow-xs hover:opacity-90 transition-all active:scale-95 cursor-pointer">
              Filter
            </button>
          </form>
        </div>
      </header>

      {(sp?.status || sp?.late || sp?.regularized || sp?.exception || sp?.employee) && (
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-ink-3">Active filters:</span>
          {sp?.status && <span className="bg-surface-2 border border-line px-2 py-0.5 rounded text-ink-2">Status: {sp.status}</span>}
          {sp?.late && <span className="bg-surface-2 border border-line px-2 py-0.5 rounded text-ink-2">Late only</span>}
          {sp?.regularized && <span className="bg-surface-2 border border-line px-2 py-0.5 rounded text-ink-2">Corrections</span>}
          {sp?.exception && <span className="bg-surface-2 border border-line px-2 py-0.5 rounded text-ink-2">Exceptions</span>}
          {sp?.employee && <span className="bg-surface-2 border border-line px-2 py-0.5 rounded text-ink-2">Emp: {sp.employee}</span>}
          <Link href={`/history/attendance?start=${start}&end=${end}`} className="text-blue-500 hover:underline ml-2">Clear all</Link>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
        <table className="w-full min-w-[800px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">First In</th>
              <th className="px-4 py-3">Last Out</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-3 font-mono">
                  No records found for the selected period.
                </td>
              </tr>
            ) : (
              filteredRows.map((r, i) => {
                const shiftDate = parseISO(r.shift_date);
                return (
                  <tr key={`${r.employee_code}-${r.shift_date}-${i}`} className="border-b border-line/60 last:border-0 hover:bg-surface-2/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-ink-2 whitespace-nowrap">
                      {format(shiftDate, 'MMM d, yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <HoverProfile data={{ name: r.full_name, code: r.employee_code }}>
                        <Link
                          href={`/month/${r.employee_code}?start=${start}&end=${end}`}
                          className="font-semibold text-ink hover:underline hover:text-accent cursor-pointer transition-colors"
                        >
                          {r.full_name}
                        </Link>
                      </HoverProfile>
                      <div className="text-[10px] font-mono text-ink-3 mt-0.5">
                        <Link
                          href={`/month/${r.employee_code}?start=${start}&end=${end}`}
                          className="hover:underline hover:text-accent transition-colors"
                        >
                          {r.employee_code}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Status 
                        value={r.status} 
                        isRegularized={r.is_regularized} 
                      />
                      {r.late_minutes > 0 && <span className="text-[10px] text-yellow-600 ml-2">Late: {r.late_minutes}m</span>}
                      {r.has_exception && <span className="text-[10px] text-purple-600 ml-2" title={r.exception_note || ''}>⚠️ Exception</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-2">
                      {r.first_in ? hhmm(r.first_in) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-2">
                      {r.last_out ? hhmm(r.last_out) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[10px] font-mono text-ink-3 max-w-[200px] truncate">
                      {r.worked_minutes > 0 && <span>{Math.floor(r.worked_minutes / 60)}h {r.worked_minutes % 60}m </span>}
                      {r.punch_count > 0 && <span className="opacity-60 ml-2">({r.punch_count} punches)</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
