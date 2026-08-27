import Link from 'next/link';

import { BoardToolbar } from '@/components/BoardToolbar';
import { Tiles } from '@/components/Tiles';
import { MyMonth } from '@/components/MyMonth';
import { getBoard, getMyMonth, getRejected, hhmm } from '@/lib/api';
import { proxy } from '@/lib/format';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string }>;
}) {
  const { on } = await searchParams;
  const me = await currentIdentity();
  const result = await getBoard(on);

  // A plain employee has no company board to see, and telling them the server
  // is broken would be a lie. They get their own attendance instead - which is
  // the thing they actually came for.
  if (!result.ok && result.reason === 'forbidden') {
    const now = new Date();
    const mine = await getMyMonth(now.getUTCFullYear(), now.getUTCMonth() + 1);
    return <MyMonth data={mine} name={me?.full_name ?? null} />;
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
          <button className="rounded bg-accent px-3 py-1.5 font-semibold text-white">Go</button>
        </form>
      </div>

      {/*
        Month-end export. A plain link, not a fetch: the browser's own download
        handling is the "one click" the PRD asks for, and it goes through the
        gateway so the token is attached server-side rather than being readable
        by page JavaScript.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 bx-card px-5 py-4">
        <p className="max-w-prose text-sm text-ink-2">
          <span className="font-medium text-ink">Month-end register.</span>{' '}
          Every employee, every day, recomputed from the punches at the moment you
          download it — so it cannot disagree with this board.
        </p>
        <a
          href={proxy(`/api/v1/admin/export/month.csv?year=${monthOf.year}&month=${monthOf.month}`)}
          className="whitespace-nowrap rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white"
        >
          Download {monthOf.label}
        </a>
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
        <BoardToolbar rows={board.rows} />
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
          <div className="overflow-x-auto bx-card">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Why it was refused</th>
                  <th className="px-4 py-3 font-medium">Distance</th>
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
                    {/*
                      Its own column as well as being inside the sentence, so
                      it can be scanned down and sorted by eye.

                      A dash is not missing data. check_presence() returns
                      early on a spoofed fix without measuring anything, on the
                      grounds that a distance computed from coordinates the
                      phone admits are fake would be a number that looks like
                      evidence and is not. Showing "-" says that honestly.
                    */}
                    <td className="tnum px-4 py-3 text-ink-3">
                      {r.distance_m === null ? '—' : `${Math.round(r.distance_m)}m`}
                    </td>
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
