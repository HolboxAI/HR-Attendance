import Link from 'next/link';

import { BoardTable } from '@/components/BoardTable';
import { Tiles } from '@/components/Tiles';
import { getBoard, getRejected, hhmm } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string }>;
}) {
  const { on } = await searchParams;
  const [board, rejected] = await Promise.all([getBoard(on), getRejected()]);

  if (!board) {
    return (
      <div className="rounded border border-st-absent/50 bg-surface p-6">
        <h2 className="text-lg font-semibold">The API isn&apos;t running</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          Start it and this page will fill in:
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-3 text-xs text-ink-2">
cd apps/api && .venv/bin/uvicorn app.main:app --reload</pre>
      </div>
    );
  }

  const exceptions = board.rows.filter((r) => r.has_exception);
  const day = new Date(`${board.shift_date}T00:00:00Z`);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="font-display text-3xl font-bold tracking-tight"
          >
            {day.toLocaleDateString('en-IN', {
              weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
            })}
          </h1>
          <p className="text-sm text-ink-3">
            Recomputed from raw punches on every load — this screen cannot drift from the data.
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <label htmlFor="on" className="text-ink-3">Date</label>
          <input
            id="on" name="on" type="date" defaultValue={board.shift_date}
            className="rounded border border-line bg-surface-2 px-3 py-1.5 text-ink"
          />
          <button className="rounded bg-accent px-3 py-1.5 font-semibold text-[#1A1206]">Go</button>
        </form>
      </div>

      <Tiles summary={board.summary} />

      {exceptions.length > 0 && (
        <section className="rounded border border-st-late/40 bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-st-late">
            Needs attention · {exceptions.length}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            These days can&apos;t be counted until someone resolves them. A correction adds a
            new punch — it never edits the original.
          </p>
          <ul className="mt-3 space-y-2">
            {exceptions.map((r) => (
              <li key={r.employee_code} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-medium">{r.full_name}</span>
                <span className="text-ink-3">in at {hhmm(r.first_in)}</span>
                <span className="text-st-late">{r.exception_note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">Everyone</h2>
        <BoardTable rows={board.rows} />
      </section>

      {rejected && rejected.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
            Refused punches · last 7 days
          </h2>
          <p className="max-w-prose text-sm text-ink-2">
            These never counted towards anyone&apos;s hours, but they&apos;re kept. When someone
            says &ldquo;the app wouldn&apos;t let me check in&rdquo;, this is the answer.
          </p>
          <div className="overflow-x-auto rounded border border-line bg-surface">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Why it was refused</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((r, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3">
                      {r.full_name}
                      <span className="ml-2 text-xs text-ink-3">{r.employee_code}</span>
                    </td>
                    <td className="tnum px-4 py-3 text-ink-3">{hhmm(r.at)}</td>
                    <td className="px-4 py-3 text-st-absent">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-ink-3">
        Click anyone to see their month. <Link href="/month/BX001" className="text-accent">Example</Link>.
      </p>
    </div>
  );
}
