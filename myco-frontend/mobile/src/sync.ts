/**
 * Draining the offline queue.
 *
 * Runs on app launch, whenever the app comes back to the foreground, and after
 * any successful punch - the three moments a connection is most likely to have
 * returned. There is no background task and no timer: a check-in app that
 * wakes the radio on a schedule to retry is a battery complaint waiting to
 * happen, and the person will open the app tomorrow morning anyway.
 */
import { PermanentPunchError, submitPunch } from './api';
import { list, note, photoUri, remove, type Pending } from './queue';

export type SyncResult = {
  sent: number;
  failed: number;
  dropped: number;      // refused for good - too old to ever land
  remaining: number;
  messages: string[];   // reasons for anything dropped, so it can be shown
};

let running = false;

export async function flush(): Promise<SyncResult> {
  const empty: SyncResult = { sent: 0, failed: 0, dropped: 0, remaining: 0, messages: [] };
  // One drain at a time. Launch and foreground can fire together, and two
  // passes over the same file would race to delete it.
  if (running) return empty;
  running = true;

  const result: SyncResult = { ...empty, messages: [] };
  try {
    for (const item of list()) {
      try {
        await send(item);
        remove(item);
        result.sent += 1;
      } catch (err) {
        if (err instanceof PermanentPunchError) {
          // Keeping it would mean retrying forever. Drop it, but say why -
          // silently discarding is the behaviour this whole module exists to
          // undo.
          remove(item);
          result.dropped += 1;
          result.messages.push(err.message);
        } else {
          note(item, err instanceof Error ? err.message : 'unknown');
          result.failed += 1;
        }
      }
    }
  } finally {
    running = false;
  }
  result.remaining = list().length;
  return result;
}

async function send(item: Pending): Promise<void> {
  await submitPunch({
    photoUri: photoUri(item),
    lat: item.lat,
    lng: item.lng,
    accuracyM: item.accuracyM,
    isMocked: item.isMocked,
    direction: item.direction,
    capturedAt: new Date(item.capturedAt),
  });
}

export function pendingCount(): number {
  return list().length;
}
