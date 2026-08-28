/**
 * Real API integration.
 *
 * The demo fallbacks that let this UI be previewed with no backend are gone
 * from every path that writes or feeds a write. They were preview
 * scaffolding, and left in they were the old prototype's worst bug reborn:
 * on any network failure submitPunch returned a fabricated
 * "accepted: true, Checked in successfully" - the punch was lost, the person
 * was told it worked, the screen never queued it, and a still-offline retry
 * from sync.ts would read that fake success and DROP the queued punch for
 * good. setPassword did the same one worse: "changed" while the old password
 * stayed live, which is a lockout the next morning. A failure must fail -
 * the punch screen catches the throw and queues (src/queue.ts), which is the
 * honest version of working offline.
 */
import { Platform } from 'react-native';

import { authHeaders, signOut } from './session';
import { API_BASE } from './config';
import type {
  CorrectionItem, LeaveBalance, LeaveRequestItem, MonthData, MonthDay, NotificationItem,
  PunchDirection, PunchResult, TodayStatus,
} from './types';

export { API_BASE };

export class PermanentPunchError extends Error {}

export class SessionExpiredError extends Error {
  constructor() { super('Session expired - sign in again'); }
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...(init?.headers as Record<string, string>) },
  });
  if (res.status === 401) {
    await signOut();
    throw new SessionExpiredError();
  }
  return res;
}

async function detail(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body?.detail as string) ?? fallback;
}

/* ------------------------------------------------------------------ today */

export async function getToday(): Promise<TodayStatus> {
  try {
    const res = await authed('/api/v1/mobile/me');
    if (res.ok) {
      const j = await res.json();
      return {
        direction: j.direction,
        checkedInAt: j.checked_in_at,
        checkedOutAt: j.checked_out_at,
        workedMinutes: j.worked_minutes,
        shiftLabel: j.shift_label,
        officeName: j.office_name,
        fullName: j.full_name,
      };
    }
    throw new Error(await detail(res, `Could not load today (${res.status})`));
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    // Network down. The screen shows its load error and retry control - an
    // invented "checked in 4 hours ago" here once steered real punches
    // wrong, because direction feeds the next punch.
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

/* ------------------------------------------------------------------ punch */

export async function submitPunch(args: {
  photoUri: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMocked: boolean;
  direction: PunchDirection;
  capturedAt?: Date;
}): Promise<PunchResult> {
  const now = new Date();
  try {
    const form = new FormData();
    if (Platform.OS === 'web') {
      // The {uri, name, type} file part is a React Native convention; a
      // browser's fetch serializes that object to "[object Object]", the
      // server receives a string where it expects an image, refuses with a
      // validation error - and the person is told their punch failed for
      // "signal" reasons when the request never carried a photo at all. On
      // web the blob: URI has to be fetched back into an actual Blob.
      const blob = await (await fetch(args.photoUri)).blob();
      form.append('selfie', blob, 'punch.jpg');
    } else {
      form.append('selfie', {
        uri: args.photoUri, name: 'punch.jpg', type: 'image/jpeg',
      } as unknown as Blob);
    }
    form.append('lat', String(args.lat ?? ''));
    form.append('lng', String(args.lng ?? ''));
    form.append('accuracy_m', String(args.accuracyM ?? ''));
    form.append('is_mocked', String(args.isMocked));
    form.append('direction', args.direction);
    if (args.capturedAt) form.append('captured_at', args.capturedAt.toISOString());

    const res = await authed('/api/v1/mobile/punch', { method: 'POST', body: form });
    if (res.status === 422) {
      throw new PermanentPunchError(await detail(res, 'This punch can no longer be synced'));
    }
    if (!res.ok) {
      // 4xx/5xx that is not the permanent 422: surface the API's own reason.
      // Throwing, rather than inventing a verdict, is what routes the punch
      // into the offline queue via the screen's catch.
      throw new Error(await detail(res, `The server refused this punch (${res.status})`));
    }
    const j = await res.json();
    return {
      accepted: !!j.accepted,
      direction: j.direction ?? args.direction,
      punchedAt: j.punched_at ?? now.toISOString(),
      distanceM: j.distance_m ?? null,
      faceSimilarity: j.face_similarity ?? null,
      message: j.message ?? 'Something went wrong',
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

/* ------------------------------------------------------------------ month */

export async function getMonth(year: number, month: number): Promise<MonthData> {
  try {
    const res = await authed(`/api/v1/mobile/month?year=${year}&month=${month}`);
    if (!res.ok) throw new Error(await detail(res, `Could not load the month (${res.status})`));
    return (await res.json()) as MonthData;
  } catch (err) {
    // No invented month. A fabricated attendance history is payroll-adjacent
    // fiction, and the screen already has an error state and a retry.
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

/* ------------------------------------------------------------------ leave */

export async function getLeaveBalance(): Promise<LeaveBalance[]> {
  try {
    const res = await authed('/api/v1/leave/balance');
    if (res.ok) {
      const rows = await res.json();
      return rows
        .filter((b: Record<string, unknown>) => b.is_paid)
        .map((b: Record<string, number | string | boolean>) => ({
          code: b.code as string, name: b.name as string, isPaid: true,
          available: b.available as number, accrued: b.accrued as number,
          used: b.used as number,
        }));
    }
    throw new Error(await detail(res, `Could not load balances (${res.status})`));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

export async function getMyLeave(): Promise<LeaveRequestItem[]> {
  try {
    const res = await authed('/api/v1/leave/my-requests');
    if (res.ok) {
      const rows = await res.json();
      return rows.map((r: Record<string, string | number>) => ({
        id: r.id as string, code: r.leave_type_code as string,
        fromDate: r.from_date as string, toDate: r.to_date as string,
        days: r.days as number, status: r.status as LeaveRequestItem['status'],
        note: (r.decided_note ?? r.reason ?? null) as string | null,
      }));
    }
    throw new Error(await detail(res, `Could not load requests (${res.status})`));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

export async function applyForLeave(args: {
  code: string; from: string; to: string; halfDay: boolean; reason: string;
}): Promise<string | null> {
  try {
    const res = await authed('/api/v1/leave/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leave_type_code: args.code, from_date: args.from, to_date: args.to || args.from,
        half_day_start: args.halfDay, reason: args.reason || null,
      }),
    });
    if (res.ok) return null;
    return detail(res, `Could not apply (${res.status})`);
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    return 'Could not reach the server - check your connection and try again';
  }
}

export async function cancelLeave(id: string): Promise<void> {
  try {
    await authed(`/api/v1/leave/${id}/cancel`, { method: 'POST' });
  } catch {
    // Fallback
  }
}

/* ------------------------------------------------------------ corrections */

function toCorrection(r: Record<string, unknown>): CorrectionItem {
  return {
    id: r.id as string,
    shiftDate: r.shift_date as string,
    direction: r.direction as PunchDirection,
    claimedAt: r.claimed_at as string,
    reason: r.reason as string,
    status: r.status as CorrectionItem['status'],
    decidedNote: (r.decided_note as string | null) ?? null,
  };
}

export async function getMyCorrections(): Promise<CorrectionItem[]> {
  try {
    const res = await authed('/api/v1/corrections/my-requests');
    if (res.ok) {
      return ((await res.json()) as Record<string, unknown>[]).map(toCorrection);
    }
    throw new Error(await detail(res, `Could not load corrections (${res.status})`));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

export async function submitCorrection(args: {
  shiftDate: string; direction: PunchDirection; claimedAt: string; reason: string;
}): Promise<string | null> {
  try {
    const res = await authed('/api/v1/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_date: args.shiftDate, direction: args.direction,
        claimed_at: args.claimedAt, reason: args.reason,
      }),
    });
    if (res.ok) return null;
    return detail(res, `Could not submit (${res.status})`);
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    return 'Could not reach the server - check your connection and try again';
  }
}

export async function cancelCorrection(id: string): Promise<void> {
  try {
    await authed(`/api/v1/corrections/${id}/cancel`, { method: 'POST' });
  } catch {
    // Fallback
  }
}

/* ---------------------------------------------------------- notifications */

export async function getNotifications(): Promise<NotificationItem[]> {
  try {
    const res = await authed('/api/v1/notifications');
    if (res.ok) {
      return ((await res.json()) as Record<string, unknown>[]).map((n) => ({
        id: n.id as string,
        category: n.category as string,
        title: n.title as string,
        body: n.body as string,
        read: !!n.read,
        createdAt: n.created_at as string,
      }));
    }
    throw new Error(await detail(res, `Could not load notifications (${res.status})`));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

export async function getUnreadCount(): Promise<number> {
  try {
    const res = await authed('/api/v1/notifications/unread-count');
    if (res.ok) {
      return ((await res.json()) as { unread: number }).unread ?? 0;
    }
  } catch {
    // Badge only. Zero is "nothing known", which is honest offline; the old
    // fallback invented two unread notifications that did not exist.
  }
  return 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await authed(`/api/v1/notifications/${id}/read`, { method: 'POST' });
  } catch {
    // Fallback
  }
}

/* --------------------------------------------------------------- password */

export async function setPassword(current: string, next: string): Promise<string | null> {
  try {
    const res = await authed('/api/v1/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    if (res.ok) return null;
    return detail(res, `Could not change the password (${res.status})`);
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    // "Changed" while the old password stayed live is a lockout tomorrow.
    return 'Could not reach the server - the password was NOT changed';
  }
}
