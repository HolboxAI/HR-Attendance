import { statusGlyph, statusLabel, statusText } from '@/components/Status';
import { hours, type MonthDay } from '@/lib/format';

/**
 * A month at a glance: a real 7-column calendar, weeks aligned, each day
 * carrying its status glyph + number. Colour is reinforced by the glyph and a
 * title/aria label, never load-bearing. Future days render empty - nobody is
 * absent for a day that has not happened.
 */
export function MonthCalendar({
  days, year, month,
}: {
  days: MonthDay[]; year: number; month: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const blanks = Array.from({ length: firstDow });

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="mx-auto w-full max-w-md">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-mono font-semibold uppercase tracking-wider text-ink-3">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {blanks.map((_, i) => <div key={`b${i}`} aria-hidden />)}
        {days.map((d) => {
          const future = d.date > today;
          const off = d.status === 'weekly_off' || d.status === 'holiday';
          const label = future
            ? `${d.date}: upcoming`
            : `${d.date}: ${statusLabel(d.status)}${d.worked_minutes ? `, ${hours(d.worked_minutes)}` : ''}${d.has_exception ? ', needs attention' : ''}`;
          return (
            <div
              key={d.date}
              title={label}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-all ${
                d.date === today ? 'border-accent bg-accent/15 shadow-sm' : 'border-line/40 glass-panel'
              } ${future ? 'opacity-30' : off ? 'opacity-50' : 'hover:scale-105'}`}
            >
              <span className="sr-only">{label}</span>
              <span aria-hidden className={`text-xs ${future ? 'text-ink-3' : statusText(d.status)}`}>
                {future ? '·' : statusGlyph(d.status)}
              </span>
              <span aria-hidden="true" className="tnum font-mono text-xs text-ink">{Number(d.date.slice(8))}</span>
              {d.has_exception && !future && (
                <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-st-late animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-3 font-mono border-t border-line/40 pt-3">
        <span><span aria-hidden className="text-st-present">●</span> Present</span>
        <span><span aria-hidden className="text-st-half">◐</span> Half day</span>
        <span><span aria-hidden className="text-st-half">◇</span> On leave</span>
        <span><span aria-hidden className="text-st-absent">○</span> Absent</span>
        <span><span aria-hidden>–</span> Off / holiday</span>
        <span><span aria-hidden className="text-st-late">•</span> corner dot = exception</span>
      </div>
    </div>
  );
}
