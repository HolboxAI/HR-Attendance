/**
 * Punches taken with no signal, kept until they land.
 *
 * This exists because the app used to tell people "saved on your phone and
 * will sync automatically" while saving nothing at all. The punch, the selfie
 * and the GPS reading were discarded, the person walked away believing they
 * had checked in, and at month end they were absent for a day they worked.
 * That is the single worst failure this system can have.
 *
 * Two things make it durable:
 *
 * - **The photo is copied out of the camera cache.** expo-camera writes to the
 *   cache directory, which the OS is free to empty under storage pressure. A
 *   queued punch whose selfie has evaporated is not a punch. Both the photo
 *   and its metadata go to the document directory instead.
 * - **The captured time travels with it.** The server stamps live punches with
 *   its own clock, but a queued one has to carry the moment it happened or a
 *   basement check-in at 9:34 arrives as 11:00. The server bounds what it will
 *   accept; see the captured_at handling in routes/mobile.py.
 *
 * Retrying is safe: the server dedupes on identity plus second, so the same
 * queued punch sent twice produces one row.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { PunchDirection } from './types';

const DIR = 'pending-punches';

export type Pending = {
  id: string;
  capturedAt: string;          // ISO, when the person actually tapped
  direction: PunchDirection;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMocked: boolean;
  photo: string;               // file name inside the queue directory
  attempts: number;
  lastError: string | null;
};

function dir(): Directory {
  const d = new Directory(Paths.document, DIR);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

function id(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Save a punch that could not be sent. Returns null if even saving failed. */
export async function enqueue(args: {
  photoUri: string;
  capturedAt: Date;
  direction: PunchDirection;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMocked: boolean;
}): Promise<Pending | null> {
  try {
    const d = dir();
    const key = id();
    const photoName = `${key}.jpg`;

    // Copy, do not reference. The source lives in the camera's cache.
    new File(args.photoUri).copy(new File(d, photoName));

    const item: Pending = {
      id: key,
      capturedAt: args.capturedAt.toISOString(),
      direction: args.direction,
      lat: args.lat,
      lng: args.lng,
      accuracyM: args.accuracyM,
      isMocked: args.isMocked,
      photo: photoName,
      attempts: 0,
      lastError: null,
    };
    new File(d, `${key}.json`).write(JSON.stringify(item));
    return item;
  } catch {
    // If we cannot even save it, say so rather than claiming we did.
    return null;
  }
}

export function list(): Pending[] {
  try {
    const out: Pending[] = [];
    for (const entry of dir().list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(entry.textSync()) as Pending);
      } catch {
        // A half-written record helps nobody and would retry forever.
        entry.delete();
      }
    }
    return out.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  } catch {
    return [];
  }
}

export function remove(item: Pending): void {
  const d = dir();
  for (const name of [`${item.id}.json`, item.photo]) {
    try {
      const f = new File(d, name);
      if (f.exists) f.delete();
    } catch {
      /* already gone */
    }
  }
}

export function photoUri(item: Pending): string {
  return new File(dir(), item.photo).uri;
}

export function note(item: Pending, error: string): void {
  try {
    const updated: Pending = { ...item, attempts: item.attempts + 1, lastError: error };
    new File(dir(), `${item.id}.json`).write(JSON.stringify(updated));
  } catch {
    /* best effort - the punch itself still matters more than the counter */
  }
}
