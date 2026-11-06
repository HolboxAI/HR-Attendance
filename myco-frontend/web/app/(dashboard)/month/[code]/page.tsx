import Link from 'next/link';
import { format, parseISO, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns';
import { Download, Calendar, ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle, Home, FileText, FileSpreadsheet } from 'lucide-react';

import { EditAttendance } from '@/components/EditAttendance';
import { statusGlyph, statusLabel } from '@/components/Status';
import { getMonth, hhmm, hours, proxy } from '@/lib/api';
import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ y?: string; m?: string; start?: string; end?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;

  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const thisMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

  const lastMonthDate = subMonths(now, 1);
  const lastMonthStart = format(startOfMonth(lastMonthDate), 'yyyy-MM-dd');
  const lastMonthEnd = format(endOfMonth(lastMonthDate), 'yyyy-MM-dd');

  let startDate: string;
  let endDate: string;

  if (sp.start && sp.end) {
    startDate = sp.start <= sp.end ? sp.start : sp.end;
    endDate = sp.start <= sp.end ? sp.end : sp.start;
  } else if (sp.y && sp.m) {
    const y = Number(sp.y) || now.getUTCFullYear();
    const m = Number(sp.m) || now.getUTCMonth() + 1;
    const targetDate = new Date(Date.UTC(y, m - 1, 1));
    startDate = format(startOfMonth(targetDate), 'yyyy-MM-dd');
    endDate = format(endOfMonth(targetDate), 'yyyy-MM-dd');
  } else {
    startDate = thisMonthStart;
    endDate = thisMonthEnd;
  }

  const parsedStart = parseISO(startDate);
  const prevMonthStart = format(startOfMonth(subMonths(parsedStart, 1)), 'yyyy-MM-dd');
  const prevMonthEnd = format(endOfMonth(subMonths(parsedStart, 1)), 'yyyy-MM-dd');
  const nextMonthStart = format(startOfMonth(addMonths(parsedStart, 1)), 'yyyy-MM-dd');
  const nextMonthEnd = format(endOfMonth(addMonths(parsedStart, 1)), 'yyyy-MM-dd');

  const me = await currentIdentity();
  const canEdit = capabilitiesFor(me?.role).canDecideCorrections;
  const data = await getMonth(code, undefined, undefined, startDate, endDate);
  if (!data) {
    return (
      <div className="rounded-2xl border border-line glass-panel p-8 text-center space-y-4">
        <p className="text-st-absent font-medium">Couldn&apos;t load attendance records for {code}.</p>
        <Link href="/history/attendance" className="inline-flex items-center gap-2 text-sm text-accent hover:underline">
          <ArrowLeft className="size-4" /> Return to Attendance History
        </Link>
      </div>
    );
  }

  const parsedEnd = parseISO(endDate);
  const formattedStart = format(parsedStart, 'dd MMM yyyy');
  const formattedEnd = format(parsedEnd, 'dd MMM yyyy');
  const periodLabel = startDate === endDate ? formattedStart : `${formattedStart} – ${formattedEnd}`;

  const pdfDownloadUrl = proxy(
    `/api/v1/admin/export/employee.pdf?employee_code=${encodeURIComponent(code)}&start_date=${startDate}&end_date=${endDate}`,
  );
  const excelDownloadUrl = proxy(
    `/api/v1/admin/export/employee.csv?employee_code=${encodeURIComponent(code)}&start_date=${startDate}&end_date=${endDate}`,
  );

  const leavesByType = data.totals.leaves_by_type || {};
  const leaveDetailsStr = Object.entries(leavesByType)
    .map(([typeCode, count]) => `${typeCode}: ${count}`)
    .join(', ');

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3 text-xs font-mono text-ink-3">
            <Link
              href={`/history/attendance?start=${startDate}&end=${endDate}`}
              className="hover:text-ink transition-colors flex items-center gap-1 text-accent"
            >
              <ArrowLeft className="size-3.5" /> Attendance History
            </Link>
            <span>·</span>
            <Link href={`/people/${code}`} className="hover:text-ink transition-colors">
              Employee Profile
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-ink">
              {data.full_name}
            </h1>
            <span className="rounded-md bg-surface-2 border border-line px-2 py-0.5 text-xs font-mono text-ink-2">
              {code}
            </span>
            {data.department && (
              <span className="rounded-md bg-surface-2 border border-line px-2 py-0.5 text-xs font-mono text-ink-3">
                {data.department}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-3 flex items-center gap-1.5 font-mono">
            <Calendar className="size-4 text-ink-3/70" />
            <span>{periodLabel}</span>
          </p>
        </div>

        {/* Action Controls & Downloads (Excel & PDF) */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={excelDownloadUrl}
            download={`attendance_${code}_${startDate}_${endDate}.csv`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider shadow-xs hover:bg-emerald-500/20 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
            title="Download employee attendance report in Excel format"
          >
            <FileSpreadsheet className="size-4 text-emerald-500" />
            <span>Download Excel</span>
          </a>
          <a
            href={pdfDownloadUrl}
            download={`attendance_${code}_${startDate}_${endDate}.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl bg-ink text-ground px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider shadow-xs hover:opacity-90 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
            title="Download employee attendance report in PDF format"
          >
            <Download className="size-4" />
            <span>Download PDF</span>
          </a>
        </div>
      </div>

      {/* Date Filter Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-2xl glass-panel border border-line p-3">
        {/* Presets & Month Stepper */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <div className="flex items-center gap-1 bg-surface-2/60 border border-line rounded-xl p-1">
            <Link
              href={`/month/${code}?start=${todayStr}&end=${todayStr}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                startDate === todayStr && endDate === todayStr
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Today
            </Link>
            <Link
              href={`/month/${code}?start=${thisMonthStart}&end=${thisMonthEnd}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                startDate === thisMonthStart && endDate === thisMonthEnd
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              This Month
            </Link>
            <Link
              href={`/month/${code}?start=${lastMonthStart}&end=${lastMonthEnd}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                startDate === lastMonthStart && endDate === lastMonthEnd
                  ? 'bg-surface text-ink font-bold shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Last Month
            </Link>
          </div>

          <div className="flex items-center gap-1 text-xs font-mono ml-1">
            <Link
              href={`/month/${code}?start=${prevMonthStart}&end=${prevMonthEnd}`}
              className="rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5 text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
              title="Previous Month"
            >
              ← Prev Month
            </Link>
            <Link
              href={`/month/${code}?start=${nextMonthStart}&end=${nextMonthEnd}`}
              className="rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5 text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
              title="Next Month"
            >
              Next Month →
            </Link>
          </div>
        </div>

        {/* Custom From / To Date Filter Form */}
        <form action={`/month/${code}`} method="GET" className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-ink-3">From</span>
            <input
              id="start"
              name="start"
              type="date"
              defaultValue={startDate}
              aria-label="From date"
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs bg-transparent"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-ink-3">To</span>
            <input
              id="end"
              name="end"
              type="date"
              defaultValue={endDate}
              aria-label="To date"
              className="rounded-xl border border-line glass-panel px-3 py-1.5 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs bg-transparent"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-surface-2 border border-line hover:bg-ink hover:text-ground text-ink px-3.5 py-1.5 font-bold uppercase tracking-wider shadow-xs transition-all active:scale-95 cursor-pointer"
          >
            Apply
          </button>
        </form>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Present</div>
          <div className="tnum mt-1 text-2xl font-bold text-st-present">{data.totals.present ?? 0}</div>
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Absent</div>
          <div className="tnum mt-1 text-2xl font-bold text-st-absent">{data.totals.absent ?? 0}</div>
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Leaves</div>
          <div className="tnum mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {data.totals.on_leave ?? 0}
          </div>
          {leaveDetailsStr && (
            <div className="text-[9px] font-mono text-ink-3 mt-0.5 truncate" title={leaveDetailsStr}>
              {leaveDetailsStr}
            </div>
          )}
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Half Days</div>
          <div className="tnum mt-1 text-2xl font-bold text-st-half">{data.totals.half_day ?? 0}</div>
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">WFH</div>
          <div className="tnum mt-1 text-2xl font-bold text-cyan-600 dark:text-cyan-400">
            {data.totals.wfh ?? 0}
          </div>
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Hours</div>
          <div className="tnum mt-1 text-xl font-bold text-accent">
            {hours(data.totals.worked_minutes ?? 0)}
          </div>
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Late Mins</div>
          <div className="tnum mt-1 text-2xl font-bold text-st-late">
            {data.totals.late_minutes ? `${data.totals.late_minutes}m` : '0m'}
          </div>
        </div>

        <div className="bx-card px-3.5 py-3 rounded-2xl glass-panel border border-line">
          <div className="text-[10px] uppercase tracking-wider font-mono text-ink-3">Corrected</div>
          <div className="tnum mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {data.totals.regularized ?? 0}
          </div>
        </div>
      </div>

      {/* Attendance Detail Table */}
      <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
        <table className="w-full min-w-[1680px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              <th className="px-3 py-3">Date</th>
              {canEdit && <th className="px-3 py-3">Edit</th>}
              <th className="px-3 py-3">Shift</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">In</th>
              <th className="px-3 py-3">Out</th>
              <th className="px-3 py-3">Late</th>
              <th className="px-3 py-3">Break times</th>
              <th className="px-3 py-3">Break</th>
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
            {data.days.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-4 py-8 text-center text-ink-3 font-mono">
                  No attendance records found for this period.
                </td>
              </tr>
            ) : (
              data.days.map((d) => {
                const off = d.status === 'weekly_off' || d.status === 'holiday';
                const isLeave = d.status === 'on_leave' || d.status === 'half_day';
                const leaveBadge = d.leave_code ? ` (${d.leave_code})` : '';

                return (
                  <tr
                    key={d.date}
                    className={`border-b border-line/60 last:border-0 hover:bg-surface-2/30 transition-colors ${
                      off ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Date & Weekday */}
                    <td className="tnum px-3 py-2.5 whitespace-nowrap font-mono">
                      <span className="font-semibold text-ink">{d.date}</span>{' '}
                      <span className="text-ink-3 text-[11px]">({d.weekday})</span>
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2.5">
                        <EditAttendance
                          employeeCode={code}
                          date={d.date}
                          status={d.status}
                          firstIn={d.first_in}
                          lastOut={d.last_out}
                          workedLabel={hours(d.worked_minutes)}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-mono text-ink-2 whitespace-nowrap">{d.shift_allotted || '—'}</td>

                    {/* Status */}
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-ink-3" aria-hidden>
                          {statusGlyph(d.status)}
                        </span>
                        <span className="font-medium text-ink">
                          {statusLabel(d.status === 'wfh' ? 'present' : d.status)}
                          {isLeave && leaveBadge}
                        </span>
                        {(d.status === 'wfh' || d.is_wfh) && (
                          <span className="rounded bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.2 text-[9px] font-mono text-cyan-600 dark:text-cyan-400 font-semibold">
                            WFH
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Punch In */}
                    <td className="tnum px-4 py-2.5 font-mono text-ink-2">
                      {hhmm(d.first_in)}
                    </td>

                    {/* Punch Out */}
                    <td className="tnum px-3 py-2.5 font-mono text-ink-2">
                      {hhmm(d.last_out)}
                    </td>

                    {/* Late */}
                    <td className="tnum px-3 py-2.5 font-mono text-st-late">
                      {d.late_minutes ? `${d.late_minutes}m` : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">{d.break_windows || '—'}</td>
                    <td className="tnum px-3 py-2.5 font-mono text-ink-2">
                      {d.break_minutes ? `${d.break_minutes}m` : '—'}
                    </td>
                    <td className="tnum px-3 py-2.5 font-mono text-ink-2">
                      {hours(d.worked_minutes)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">{d.extra_str || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">{d.punctuality || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">{d.regularised_by || 'N/A'}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">{d.leave_status || 'N/A'}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2">{d.leave_approved_by || 'N/A'}</td>
                    <td className="px-3 py-2.5 font-mono text-ink-2 max-w-[240px]">{d.remarks || '—'}</td>
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
