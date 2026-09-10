import Link from 'next/link';

import { BoardExceptionsList } from '@/components/BoardExceptionsList';
import { BoardRefusedTable } from '@/components/BoardRefusedTable';
import { BoardToolbar } from '@/components/BoardToolbar';
import { isFilterKey } from '@/lib/boardFilters';
import { Tiles } from '@/components/Tiles';
import { EmployeeBoardHistory } from '@/components/EmployeeBoardHistory';
import { KineticTicker } from '@/components/ui/kinetic-ticker';
import { getBoard, getMyMonth, getRejected, hhmm } from '@/lib/api';
import { istYearMonth, proxy } from '@/lib/format';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string; f?: string }>;
}) {
  const { on, f } = await searchParams;
  // ?f=absent lands with that chip pre-selected - it is how the dashboard
  // tiles answer "absent: 3" with THE three people, not a generic page.
  const filter = isFilterKey(f) ? f : 'all';
  const me = await currentIdentity();
  const result = await getBoard(on);

  // A plain employee has no company board to see, and telling them the server
  // is broken would be a lie. They get their own attendance instead - which is
  // the thing they actually came for.
  if (!result.ok && result.reason === 'forbidden') {
    const ist = istYearMonth();
    let year = ist.year;
    let month = ist.month;
    if (on) {
      const parts = on.split('-').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        year = parts[0];
        month = parts[1];
      }
    }
    const mine = await getMyMonth(year, month);
    return <EmployeeBoardHistory data={mine} me={me} year={year} month={month} />;
  }

  if (!result.ok) {
    return (
      <div className="rounded border border-st-absent/50 bg-surface p-6">
        <h2 className="text-lg font-semibold">
          {result.reason === 'unreachable'
            ? "The API isn't running"
            : 'Could not load the board'}
        </h2>
        {result.reason === 'unreachable' ? (
          <>
            <p className="mt-2 max-w-prose text-sm text-ink-2">
              Start it and this page will fill in:
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-3 text-xs text-ink-2">
cd apps/api && .venv/bin/uvicorn app.main:app --reload</pre>
          </>
        ) : (
          <p className="mt-2 max-w-prose text-sm text-ink-2">
            The server answered with {result.status}. Try signing out and back in.
          </p>
        )}
      </div>
    );
  }

  const board = result.data;
  const rejected = await getRejected();

  // Export the month the viewed date falls in, not always the current one -
  // looking back at July and downloading August would be a trap.
  const viewed = new Date(`${board.shift_date}T00:00:00Z`);
  const monthOf = {
    year: viewed.getUTCFullYear(),
    month: viewed.getUTCMonth() + 1,
    label: viewed.toLocaleDateString('en-IN', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }),
  };

  const exceptions = board.rows.filter((r) => r.has_exception);
  const day = new Date(`${board.shift_date}T00:00:00Z`);

  return (
    <div className="space-y-8 fade-in-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-3">
            Institutional Attendance Register
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight text-ink mt-1">
            {day.toLocaleDateString('en-IN', {
              weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
            })}
          </h1>
          <p className="text-xs sm:text-sm text-ink-3 font-mono mt-1">
            Recomputed live from raw biometric punches on every load — zero state drift.
          </p>
        </div>
        <form className="flex items-center gap-2.5 text-xs font-mono">
          {/* Changing the date must not silently drop an active filter. */}
          {filter !== 'all' && <input type="hidden" name="f" value={filter} />}
          <label htmlFor="on" className="text-ink-3 font-medium">Date</label>
          <input
            id="on"
            name="on"
            type="date"
            defaultValue={board.shift_date}
            className="rounded-xl border border-line glass-panel px-3.5 py-2 text-ink focus:outline-none focus:ring-1 focus:ring-ink/20 shadow-xs font-mono"
          />
          <button className="rounded-xl bg-ink text-ground px-4 py-2 font-bold uppercase tracking-wider shadow-xs hover:opacity-90 transition-all active:scale-95 cursor-pointer">
            Go
          </button>
        </form>
      </div>

      {/* Kinetic Velocity Live Ticker */}
      <KineticTicker
        items={[
          "DAILY ATTENDANCE BOARD",
          "RAW BIOMETRIC PUNCHES",
          "REAL-TIME EXCEPTIONS VERIFICATION",
          "AUDIT-READY REGISTERS",
          "100% LIVE SYNCHRONIZATION",
        ]}
      />

      {/* Month-end export */}
      <div className="flex flex-wrap items-center justify-between gap-4 glass-panel rounded-2xl px-6 py-4 border border-line">
        <p className="max-w-prose text-sm text-ink-2">
          <strong className="text-ink font-semibold">Month-end register.</strong>{' '}
          Every employee, every day, recomputed live from punches at download time.
        </p>
        {/* Same build() rows behind both formats: CSV for payroll, PDF for
            the printed, signed copy. They cannot disagree about a day. */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={proxy(`/api/v1/admin/export/month.csv?year=${monthOf.year}&month=${monthOf.month}`)}
            className="whitespace-nowrap rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider shadow-xs hover:opacity-90 transition-all active:scale-95 cursor-pointer"
          >
            Download {monthOf.label} CSV
          </a>
          <a
            href={proxy(`/api/v1/admin/export/month.pdf?year=${monthOf.year}&month=${monthOf.month}`)}
            className="whitespace-nowrap rounded-xl glass-panel border border-line px-5 py-2.5 text-xs font-black uppercase tracking-wider text-ink shadow-xs hover:bg-surface-2 transition-all active:scale-95 cursor-pointer"
          >
            PDF
          </a>
        </div>
      </div>

      <Tiles summary={board.summary} />

      {exceptions.length > 0 && (
        <section className="rounded-2xl border border-line glass-panel p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2 font-mono">
            Needs attention · {exceptions.length} exception{exceptions.length === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 text-sm text-ink-3">
            These attendance records cannot be certified until resolved with a punch correction.
          </p>
          <BoardExceptionsList exceptions={exceptions} />
        </section>
      )}

      {/* scroll-mt clears the overlay topbar when a #register link lands here.
          key={filter} remounts the toolbar when a tile changes ?f= while
          already on this page - useState(initial) alone would ignore it. */}
      <section id="register" className="scroll-mt-24 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-ink-3">
            Everyone · Daily Attendance Register
          </h2>
        </div>
        <BoardToolbar key={filter} rows={board.rows} initial={filter} />
      </section>

      {rejected && rejected.length > 0 && (
        <section id="refused" className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
            Refused punches · last 7 days
          </h2>
          <p className="max-w-prose text-xs text-ink-3">
            Punches refused due to geofencing, missing biometrics, or device mismatch are preserved for compliance audit.
          </p>
          <BoardRefusedTable rejected={rejected} />
        </section>
      )}
      <p className="text-xs text-ink-3 font-mono">Click any team member to open their complete profile, biometric records, and leave ledger.</p>
    </div>
  );
}
