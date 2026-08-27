// Deterministic colour bands, not random - reloading the board must not
// reshuffle everyone's colour. Drawn from the same palette as the status
// dots (see globals.css) rather than a new set, so an avatar never reads as
// a status indicator by accident.
const BANDS = [
  'bg-accent/20 text-accent',
  'bg-st-present/20 text-st-present',
  'bg-st-half/20 text-st-half',
  'bg-st-late/20 text-st-late',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function hash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function Avatar({ name }: { name: string }) {
  const band = BANDS[hash(name) % BANDS.length];
  return (
    <span
      className={`flex size-8 items-center justify-center rounded-full text-xs font-semibold ${band}`}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
