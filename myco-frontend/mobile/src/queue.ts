/**
 * Punches taken with no signal, kept until they land.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

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

function dir(): Directory | null {
  if (Platform.OS === 'web') return null;
  try {
    const d = new Directory(Paths.document, DIR);
    if (!d.exists) d.create({ intermediates: true });
    return d;
  } catch {
    return null;
  }
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
    if (!d) return null;
    const key = id();
    const photoName = `${key}.jpg`;

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
    return null;
  }
}

export function list(): Pending[] {
  try {
    const d = dir();
    if (!d) return [];
    const out: Pending[] = [];
    for (const entry of d.list()) {
      if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(entry.textSync()) as Pending);
      } catch {
        entry.delete();
      }
    }
    return out.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  } catch {
    return [];
  }
}

export function remove(item: Pending): void {
  try {
    const d = dir();
    if (!d) return;
    for (const name of [`${item.id}.json`, item.photo]) {
      try {
        const f = new File(d, name);
        if (f.exists) f.delete();
      } catch {}
    }
  } catch {}
}

export function photoUri(item: Pending): string {
  const d = dir();
  if (!d) return '';
  return new File(d, item.photo).uri;
}

export function note(item: Pending, error: string): void {
  try {
    const d = dir();
    if (!d) return;
    const updated: Pending = { ...item, attempts: item.attempts + 1, lastError: error };
    new File(d, `${item.id}.json`).write(JSON.stringify(updated));
  } catch {}
}
