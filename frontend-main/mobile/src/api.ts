/**
 * The real API, and only the real API.
 *
 * The old app shipped with USE_MOCK = true and an in-memory pretend backend;
 * every screen looked finished while talking to nothing. That mode is gone
 * entirely rather than switched off - a mock that can be flipped back on in
 * one line is a demo waiting to be mistaken for a product. The whole file
 * assumes apps/api is running; where it is not, errors say so plainly.
 */
import { authHeaders, signOut } from './session';
import { API_BASE } from './config';
import type {
  CorrectionItem, LeaveBalance, LeaveRequestItem, MonthData, NotificationItem,
  PunchDirection, PunchResult, TodayStatus,
} from './types';

export { API_BASE };

/** The server refused this punch and always will. Stop retrying it. */
export class PermanentPunchError extends Error {}

/** Session died and could not be refreshed - the caller should re-login. */
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
  const res = await authed('/api/v1/mobile/me');
  if (!res.ok) throw new Error(await detail(res, `Could not load today (${res.status})`));
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

/* ------------------------------------------------------------------ punch */

export async function submitPunch(args: {
  photoUri: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMocked: boolean;
  direction: PunchDirection;
  /**
   * Only set when replaying a punch that was queued offline. Its presence
   * tells the server "this happened earlier than it arrived"; the server
   * bounds how far back it will believe.
   */
  capturedAt?: Date;
}): Promise<PunchResult> {
  const now = new Date();
  const form = new FormData();
  form.append('selfie', {
    uri: args.photoUri, name: 'punch.jpg', type: 'image/jpeg',
  } as unknown as Blob);
  form.append('lat', String(args.lat ?? ''));
  form.append('lng', String(args.lng ?? ''));
  form.append('accuracy_m', String(args.accuracyM ?? ''));
  form.append('is_mocked', String(args.isMocked));
  form.append('direction', args.direction);
  if (args.capturedAt) form.append('captured_at', args.capturedAt.toISOString());

  const res = await authed('/api/v1/mobile/punch', { method: 'POST', body: form });
  if (res.status === 422) {
    // Too old to sync. The server has refused it for good; surface the reason
    // rather than retrying this punch until the end of time.
    throw new PermanentPunchError(
      await detail(res, 'This punch can no longer be synced'),
    );
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
}

/* ------------------------------------------------------------------ month */

export async function getMonth(year: number, month: number): Promise<MonthData> {
  const res = await authed(`/api/v1/mobile/month?year=${year}&month=${month}`);
  if (!res.ok) throw new Error(await detail(res, `Could not load the month (${res.status})`));
  return (await res.json()) as MonthData;
}

/* ------------------------------------------------------------------ leave */

export async function getLeaveBalance(): Promise<LeaveBalance[]> {
  const res = await authed('/api/v1/leave/balance');
  if (!res.ok) throw new Error(await detail(res, `Could not load balances (${res.status})`));
  const rows = await res.json();
  return rows
    .filter((b: Record<string, unknown>) => b.is_paid)
    .map((b: Record<string, number | string | boolean>) => ({
      code: b.code as string, name: b.name as string, isPaid: true,
      available: b.available as number, accrued: b.accrued as number,
      used: b.used as number,
    }));
}

export async function getMyLeave(): Promise<LeaveRequestItem[]> {
  const res = await authed('/api/v1/leave/my-requests');
  if (!res.ok) throw new Error(await detail(res, `Could not load requests (${res.status})`));
  const rows = await res.json();
  return rows.map((r: Record<string, string | number>) => ({
    id: r.id as string, code: r.leave_type_code as string,
    fromDate: r.from_date as string, toDate: r.to_date as string,
    days: r.days as number, status: r.status as LeaveRequestItem['status'],
    note: (r.decided_note ?? r.reason ?? null) as string | null,
  }));
}

/** Returns null on success, or the server's reason for refusing. */
export async function applyForLeave(args: {
  code: string; from: string; to: string; halfDay: boolean; reason: string;
}): Promise<string | null> {
  let res: Response;
  try {
    res = await authed('/api/v1/leave/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leave_type_code: args.code, from_date: args.from, to_date: args.to || args.from,
        half_day_start: args.halfDay, reason: args.reason || null,
      }),
    });
  } catch (err) {
    if (err instanceof SessionExpiredError) return 'Session expired - sign in again';
    return 'Could not reach the server. Check the WiFi.';
  }
  if (res.ok) return null;
  // The API refuses with the numbers in it - how many days you have, what
  // clashes. Passing that straight through is more use than "failed".
  return detail(res, `Could not apply (${res.status})`);
}

export async function cancelLeave(id: string): Promise<void> {
  await authed(`/api/v1/leave/${id}/cancel`, { method: 'POST' });
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
  const res = await authed('/api/v1/corrections/my-requests');
  if (!res.ok) throw new Error(await detail(res, `Could not load corrections (${res.status})`));
  return ((await res.json()) as Record<string, unknown>[]).map(toCorrection);
}

/** Returns null on success, or the server's reason for refusing. */
export async function submitCorrection(args: {
  shiftDate: string; direction: PunchDirection; claimedAt: string; reason: string;
}): Promise<string | null> {
  let res: Response;
  try {
    res = await authed('/api/v1/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_date: args.shiftDate, direction: args.direction,
        claimed_at: args.claimedAt, reason: args.reason,
      }),
    });
  } catch (err) {
    if (err instanceof SessionExpiredError) return 'Session expired - sign in again';
    return 'Could not reach the server. Check the WiFi.';
  }
  if (res.ok) return null;
  return detail(res, `Could not submit (${res.status})`);
}

export async function cancelCorrection(id: string): Promise<void> {
  await authed(`/api/v1/corrections/${id}/cancel`, { method: 'POST' });
}

/* ---------------------------------------------------------- notifications */

export async function getNotifications(): Promise<NotificationItem[]> {
  const res = await authed('/api/v1/notifications');
  if (!res.ok) throw new Error(await detail(res, `Could not load notifications (${res.status})`));
  return ((await res.json()) as Record<string, unknown>[]).map((n) => ({
    id: n.id as string,
    category: n.category as string,
    title: n.title as string,
    body: n.body as string,
    read: !!n.read,
    createdAt: n.created_at as string,
  }));
}

export async function getUnreadCount(): Promise<number> {
  try {
    const res = await authed('/api/v1/notifications/unread-count');
    if (!res.ok) return 0;
    return ((await res.json()) as { unread: number }).unread ?? 0;
  } catch {
    return 0;
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  await authed(`/api/v1/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
}

/* --------------------------------------------------------------- password */

/** Returns null on success, or the server's reason for refusing. */
export async function setPassword(current: string, next: string): Promise<string | null> {
  let res: Response;
  try {
    res = await authed('/api/v1/auth/set-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
  } catch (err) {
    if (err instanceof SessionExpiredError) return 'Session expired - sign in again';
    return 'Could not reach the server. Check the WiFi.';
  }
  if (res.ok) return null;
  return detail(res, `Could not change the password (${res.status})`);
}
