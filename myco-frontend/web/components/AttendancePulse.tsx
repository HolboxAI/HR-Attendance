import { hhmm, IST, type BoardRow } from '@/lib/format';

/**
 * Today's check-ins laid out across the working day - REAL first_in times
 * from the board, not a fabricated trend. At Boxcode's headcount a histogram
 * would be five bars of one; a dot-per-person timeline shows the same truth
 * (who arrived when, who was late) without inventing aggregate shapes the
 * data cannot support.
 */
export function AttendancePulse({ rows }: { rows: BoardRow[] }) {
  const punched = rows.filter((r) => r.first_in);
  if (punched.length === 0) {
    return (
      <div className="glass-panel rounded-2xl px-6 py-8 text-center text-sm text-ink-3">
        Check-ins will populate here in real-time as team members arrive.
      </div>
    );
  }

  // 7:00 - 21:00 IST covers the day shift and the start of Ritesh's nights.
  const startH = 7;
  const endH = 21;
  const pos = (iso: string) => {
    const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
    const parts = new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric', minute: 'numeric', hour12: false, timeZone: IST,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const frac = (h + m / 60 - startH) / (endH - startH);
    return Math.min(1, Math.max(0, frac)) * 100;
  };

  const hourMarks = [9, 12, 15, 18];

  return (
    <div className="glass-panel rounded-2xl px-6 py-5 relative overflow-hidden">
      <div className="relative mt-2 h-16">
        {/* axis */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-line/80" aria-hidden />
        {hourMarks.map((h) => (
          <div
            key={h}
            aria-hidden
            className="absolute top-0 h-full border-l border-dashed border-line/60"
            style={{ left: `${((h - startH) / (endH - startH)) * 100}%` }}
          >
            <span className="absolute -bottom-1 left-1.5 text-[10px] font-mono font-medium text-ink-3">
              {h === 12 ? '12:00' : h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`}
            </span>
          </div>
        ))}
        {punched.map((r, i) => (
          <span
            key={r.employee_code}
            title={`${r.full_name} · in at ${hhmm(r.first_in)}${r.late_minutes ? ` · ${r.late_minutes}m late` : ''}`}
            className={`absolute top-1/2 flex size-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full ring-2 ring-surface shadow-xs transition-transform hover:scale-125 cursor-pointer ${
              r.late_minutes > 0 ? 'bg-ink-3' : 'bg-ink'
            }`}
            style={{ left: `${pos(r.first_in!)}%`, zIndex: 10 + i }}
          >
            <span className="sr-only">
              {r.full_name} checked in at {hhmm(r.first_in)}
              {r.late_minutes ? `, ${r.late_minutes} minutes late` : ''}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-5 text-xs text-ink-3 font-mono border-t border-line/40 pt-3">
        <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-ink inline-block" /> On Time</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-ink-3 inline-block" /> Late (Past Grace)</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-ink inline-block ring-2 ring-ink/30" /> Active In Office</span>
      </div>
    </div>
  );
}
