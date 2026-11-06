import { redirect } from 'next/navigation';
import { format, startOfMonth, subDays, parseISO } from 'date-fns';
import { History, Download, FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';

import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity, apiGet } from '@/lib/session';
import { hhmm, hours, proxy } from '@/lib/format';
import { HoverProfile } from '@/components/HoverProfile';
import { Status } from '@/components/Status';

export const dynamic = 'force-dynamic';

export default async function AttendanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    start?: string;
    end?: string;
    employee?: string;
    status?: string;
    late?: string;
    regularized?: string;
    exception?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  if (!caps.canViewBoard) redirect('/');

  // Date ranges
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const tenDaysAgoStr = format(subDays(now, 9), 'yyyy-MM-dd');
  const monthStartStr = format(startOfMonth(now), 'yyyy-MM-dd');
  const thirtyDaysAgoStr = format(subDays(now, 29), 'yyyy-MM-dd');

  const end = sp?.end || todayStr;
  const start = sp?.start || monthStartStr;

  // Build backend query
  let url = `/api/v1/admin/history/attendance?start_date=${start}&end_date=${end}`;
  if (sp?.employee) url += `&employee_code=${encodeURIComponent(sp.employee)}`;
  if (sp?.status) url += `&status=${encodeURIComponent(sp.status)}`;
  if (sp?.late === 'true') url += `&late_only=true`;
  if (sp?.regularized === 'true') url += `&regularized_only=true`;
  if (sp?.exception === 'true') url += `&exception_only=true`;

  const rows: any[] = (await apiGet<any[]>(url)) ?? [];

  // Fallback client filter if backend didn't handle it
  let filteredRows = rows;
  if (sp?.late === 'true') filteredRows = filteredRows.filter((r) => r.late_minutes > 0);
  if (sp?.regularized === 'true') filteredRows = filteredRows.filter((r) => r.is_regularized);
  if (sp?.exception === 'true') filteredRows = filteredRows.filter((r) => r.has_exception);

  // Build PDF export URL reflecting all active filters
  const pdfParams = new URLSearchParams();
  pdfParams.set('start_date', start);
  pdfParams.set('end_date', end);
  if (sp?.employee) pdfParams.set('employee_code', sp.employee);
  if (sp?.status) pdfParams.set('status', sp.status);
  if (sp?.late === 'true') pdfParams.set('late_only', 'true');
  if (sp?.regularized === 'true') pdfParams.set('regularized_only', 'true');
  if (sp?.exception === 'true') pdfParams.set('exception_only', 'true');

  const pdfDownloadUrl = proxy(
    `/api/v1/admin/history/attendance/export.pdf?${pdfParams.toString()}`
  );
  const excelDownloadUrl = proxy(
    `/api/v1/admin/history/attendance/export.csv?${pdfParams.toString()}`
  );

  // Helper to preserve filters when switching ranges
  const makeRangeUrl = (newStart: string, newEnd: string) => {
    const p = new URLSearchParams();
    p.set('start', newStart);
    p.set('end', newEnd);
    if (sp?.employee) p.set('employee', sp.employee);
    if (sp?.status) p.set('status', sp.status);
    if (sp?.late) p.set('late', sp.late);
    if (sp?.regularized) p.set('regularized', sp.regularized);
    if (sp?.exception) p.set('exception', sp.exception);
    return `/history/attendance?${p.toString()}`;
  };

  const hasExtraFilters = Boolean(
    sp?.status || sp?.late || sp?.regularized || sp?.exception || sp?.employee
  );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
            <History className="size-6 text-ink-3" />
            Attendance History
          </h1>
          <p className="text-sm text-ink-3 font-mono mt-1">
            Detailed daily records for all employees. Filter by date, status, or staff and download PDF reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/history"
            className="text-xs font-mono font-semibold text-ink-2 hover:text-ink transition-colors mr-1"
          >
            ← Overview
          </Link>

          {/* Quick Range Selector */}
          <div className="flex items-center gap-1 bg-surface-2/60 border border-line rounded-xl p-1 text-[11px] font-mono">
            <Link
              href={makeRangeUrl(todayStr, todayStr)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                start === todayStr && end === todayStr
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Today
            </Link>
            <Link
              href={makeRangeUrl(tenDaysAgoStr, todayStr)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                start === tenDaysAgoStr && end === todayStr
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Last 10 Days
            </Link>
            <Link
              href={makeRangeUrl(monthStartStr, todayStr)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                start === monthStartStr && end === todayStr
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              This Month
            </Link>
            <Link
              href={makeRangeUrl(thirtyDaysAgoStr, todayStr)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                start === thirtyDaysAgoStr && end === todayStr
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Last 30 Days
            </Link>
          </div>

          {/* Custom Date & Status Filter Form */}
          <form
            action="/history/attendance"
            method="GET"
            className="flex flex-wrap items-center gap-2 text-xs font-mono"
          >
            {sp?.employee && <input type="hidden" name="employee" value={sp.employee} />}
            {sp?.late && <input type="hidden" name="late" value={sp.late} />}
            {sp?.regularized && <input type="hidden" name="regularized" value={sp.regularized} />}
            {sp?.exception && <input type="hidden" name="exception" value={sp.exception} />}

            <input
              id="start"
              name="start"
              type="date"
              defaultValue={start}
              aria-label="From date"
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs bg-surface"
            />
            <span className="text-ink-3">to</span>
            <input
              id="end"
              name="end"
              type="date"
              defaultValue={end}
              aria-label="To date"
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs bg-surface"
            />

            <select
              name="status"
              defaultValue={sp?.status || ''}
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs"
            >
              <option value="">All Statuses</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="on_leave">On Leave</option>
              <option value="half_day">Half Day</option>
              <option value="wfh">WFH</option>
            </select>

            <button
              type="submit"
              className="rounded-xl bg-ink text-ground px-3.5 py-1.5 font-bold uppercase tracking-wider shadow-xs hover:opacity-90 transition-all active:scale-95 cursor-pointer"
            >
              Filter
            </button>
          </form>

          {/* Download Buttons (Excel & PDF) */}
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={excelDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider shadow-xs hover:bg-emerald-500/20 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
              title="Download attendance report in Excel format matching currently applied filters"
            >
              <FileSpreadsheet className="size-3.5 text-emerald-500" />
              <span>Download Excel</span>
            </a>
            <a
              href={pdfDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-ground px-3.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider shadow-xs hover:opacity-90 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
              title="Download attendance report PDF matching currently applied filters"
            >
              <Download className="size-3.5" />
              <span>Download PDF</span>
            </a>
          </div>
        </div>
      </header>

      {/* Filter Chips & Quick Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono border-b border-line/50 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-3">Active filters:</span>
          {sp?.status && (
            <span className="bg-surface-2 border border-line px-2.5 py-0.5 rounded-lg text-ink-2">
              Status: {sp.status}
            </span>
          )}
          {sp?.late === 'true' && (
            <span className="bg-surface-2 border border-line px-2.5 py-0.5 rounded-lg text-yellow-500 font-semibold">
              Late only
            </span>
          )}
          {sp?.regularized === 'true' && (
            <span className="bg-surface-2 border border-line px-2.5 py-0.5 rounded-lg text-emerald-500 font-semibold">
              Corrections only
            </span>
          )}
          {sp?.exception === 'true' && (
            <span className="bg-surface-2 border border-line px-2.5 py-0.5 rounded-lg text-purple-500 font-semibold">
              Exceptions only
            </span>
          )}
          {sp?.employee && (
            <span className="bg-surface-2 border border-line px-2.5 py-0.5 rounded-lg text-ink-2">
              Employee: {sp.employee}
            </span>
          )}

          {!hasExtraFilters && (
            <span className="text-ink-3/80 italic">All visible records</span>
          )}

          {hasExtraFilters && (
            <Link
              href={`/history/attendance?start=${start}&end=${end}`}
              className="text-accent hover:underline ml-2"
            >
              Clear filters
            </Link>
          )}
        </div>

        {/* Quick Attribute Toggles */}
        <div className="flex items-center gap-2">
          <Link
            href={`/history/attendance?start=${start}&end=${end}${sp?.status ? `&status=${sp.status}` : ''}${sp?.employee ? `&employee=${sp.employee}` : ''}${sp?.late === 'true' ? '' : '&late=true'}`}
            className={`px-2.5 py-1 rounded-lg border text-[11px] transition-all ${
              sp?.late === 'true'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 font-bold'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            Late Only
          </Link>
          <Link
            href={`/history/attendance?start=${start}&end=${end}${sp?.status ? `&status=${sp.status}` : ''}${sp?.employee ? `&employee=${sp.employee}` : ''}${sp?.regularized === 'true' ? '' : '&regularized=true'}`}
            className={`px-2.5 py-1 rounded-lg border text-[11px] transition-all ${
              sp?.regularized === 'true'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 font-bold'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            Corrections
          </Link>
          <Link
            href={`/history/attendance?start=${start}&end=${end}${sp?.status ? `&status=${sp.status}` : ''}${sp?.employee ? `&employee=${sp.employee}` : ''}${sp?.exception === 'true' ? '' : '&exception=true'}`}
            className={`px-2.5 py-1 rounded-lg border text-[11px] transition-all ${
              sp?.exception === 'true'
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-500 font-bold'
                : 'border-line text-ink-3 hover:text-ink'
            }`}
          >
            Exceptions
          </Link>
          <span className="text-ink-3 ml-2">
            Showing <strong className="text-ink font-mono">{filteredRows.length}</strong> record{filteredRows.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
        <table className="w-full min-w-[1800px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Employee ID</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Department</th>
              <th className="px-3 py-3">Shift</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">In</th>
              <th className="px-3 py-3">Out</th>
              <th className="px-3 py-3">Late</th>
              <th className="px-3 py-3">Break times</th>
              <th className="px-3 py-3">Break total</th>
              <th className="px-3 py-3">Worked</th>
              <th className="px-3 py-3">Extra</th>
              <th className="px-3 py-3">Punctuality</th>
              <th className="px-3 py-3">Regularised by</th>
              <th className="px-3 py-3">Leave</th>
              <th className="px-3 py-3">Approved by</th>
              <th className="px-3 py-3">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={18} className="px-4 py-8 text-center text-ink-3 font-mono">
                  No records found for the selected period and filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((r, i) => {
                const shiftDate = parseISO(r.shift_date);
                return (
                  <tr
                    key={`${r.employee_code}-${r.shift_date}-${i}`}
                    className="border-b border-line/60 last:border-0 hover:bg-surface-2/30 transition-colors"
                  >
                    <td className="px-3 py-3 font-mono text-ink-2 whitespace-nowrap">
                      {format(shiftDate, 'MMM d, yyyy')}
                    </td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.employee_code}</td>
                    <td className="px-3 py-3">
                      <HoverProfile data={{ name: r.full_name, code: r.employee_code }}>
                        <Link
                          href={`/month/${r.employee_code}?start=${start}&end=${end}`}
                          className="font-semibold text-ink hover:underline hover:text-accent"
                        >
                          {r.full_name}
                        </Link>
                      </HoverProfile>
                    </td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.department || '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2 whitespace-nowrap">{r.shift_allotted || '—'}</td>
                    <td className="px-3 py-3">
                      <Status value={r.status} isRegularized={r.is_regularized} />
                    </td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.first_in ? hhmm(r.first_in) : '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.last_out ? hhmm(r.last_out) : '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.late_minutes ? `${r.late_minutes}m` : '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.break_windows || '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.break_minutes ? `${r.break_minutes}m` : '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{hours(r.worked_minutes || 0)}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.extra_str || '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.punctuality || '—'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.regularised_by || 'N/A'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.leave_status || 'N/A'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2">{r.leave_approved_by || 'N/A'}</td>
                    <td className="px-3 py-3 font-mono text-ink-2 max-w-[240px]">{r.remarks || '—'}</td>
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
