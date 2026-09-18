'use client';

import { useEffect, useState } from 'react';

import { proxy } from '@/lib/format';

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

function photoSrc(code?: string | null, src?: string | null): string | null {
  if (src) return src;
  if (!code) return null;
  return proxy(`/api/v1/admin/employees/directory/${encodeURIComponent(code)}/photo`);
}

export function Avatar({
  name,
  code,
  src,
}: {
  name: string;
  code?: string | null;
  src?: string | null;
}) {
  const photo = photoSrc(code, src);
  const [showPhoto, setShowPhoto] = useState(Boolean(photo));
  const band = BANDS[hash(name) % BANDS.length];

  useEffect(() => {
    setShowPhoto(Boolean(photo));
  }, [photo]);

  return (
    <span
      className={`relative flex size-8 items-center justify-center overflow-hidden rounded-full text-xs font-semibold ${band}`}
      aria-hidden
    >
      {initials(name)}
      {photo && showPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setShowPhoto(false)}
        />
      )}
    </span>
  );
}
