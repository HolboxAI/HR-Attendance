import { redirect } from 'next/navigation';
import { format, startOfMonth } from 'date-fns';
import { LayoutGrid } from 'lucide-react';

import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity, apiGet } from '@/lib/session';
import { HistoryCards, type HistoryOverviewData } from '@/components/HistoryCards';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HistoryOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; employee?: string }>;
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

  let url = `/api/v1/admin/history/overview?start_date=${start}&end_date=${end}`;
  if (sp?.employee) {
    url += `&employee_code=${encodeURIComponent(sp.employee)}`;
  }

  const data = await apiGet<HistoryOverviewData>(url);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
            <LayoutGrid className="size-6 text-ink-3" />
            History Overview
          </h1>
          <p className="text-sm text-ink-3 font-mono mt-1">
            Workforce attendance and leave distribution for the selected period.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-surface-2/60 border border-line rounded-xl p-1 text-[11px] font-mono">
            <Link
              href={`/history?start=${todayStr}&end=${todayStr}${sp?.employee ? `&employee=${sp.employee}` : ''}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${start === todayStr && end === todayStr ? 'bg-surface text-ink font-bold shadow-xs' : 'text-ink-3 hover:text-ink'}`}
            >
              Today
            </Link>
            <Link
              href={`/history?start=${monthStartStr}&end=${todayStr}${sp?.employee ? `&employee=${sp.employee}` : ''}`}
              className={`px-2.5 py-1 rounded-lg transition-all ${start === monthStartStr && end === todayStr ? 'bg-surface text-ink font-bold shadow-xs' : 'text-ink-3 hover:text-ink'}`}
            >
              This Month
            </Link>
          </div>
          <form action="/history" method="GET" className="flex items-center gap-2 text-xs font-mono">
            {sp?.employee && <input type="hidden" name="employee" value={sp.employee} />}
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

      {data ? (
        <>
          <HistoryCards data={data} />
          
          <div className="grid grid-cols-1 lg:grid-cols-1 gap-6 mt-6">
            <div className="rounded-2xl border border-line glass-panel p-6 flex flex-col justify-center text-center">
              <h3 className="text-lg font-bold text-ink mb-2">Detailed Reports</h3>
              <p className="text-sm text-ink-3 mb-6 max-w-sm mx-auto">
                Need to see individual employee attendance records or export data?
              </p>
              <div>
                <a 
                  href={`/history/attendance?start=${start}&end=${end}`}
                  className="inline-flex items-center justify-center rounded-xl bg-ink text-surface px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  View Full Attendance History
                </a>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-line glass-panel p-8 text-center text-ink-3 font-mono text-sm">
          Could not load history data. Please try again.
        </div>
      )}
    </div>
  );
}
