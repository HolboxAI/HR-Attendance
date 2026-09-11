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
import { apiBase } from './config';
import type {
  CorrectionItem, Holiday, LeaveBalance, LeaveRequestItem, MonthData, MonthDay, NotificationItem,
  PunchDirection, PunchResult, TodayStatus, WFHRequestItem
} from './types';

export class PermanentPunchError extends Error {}

export class SessionExpiredError extends Error {
  constructor() { super('Session expired - sign in again'); }
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiBase()}${path}`, {
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

export async function getIdentity() {
  try {
    const res = await authed('/api/v1/auth/me');
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    return null;
  }
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
        workedMinutes: j.worked_minutes ?? 0,
        lateMinutes: j.late_minutes ?? 0,
        shiftLabel: j.shift_label,
        shiftStart: j.shift_start ?? null,
        shiftEnd: j.shift_end ?? null,
        officeName: j.office_name,
        fullName: j.full_name,
        employeeCode: j.employee_code,
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
          used: b.used as number, requiresProof: b.requires_proof as boolean,
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
        category: (r.category ?? null) as string | null,
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
  category?: string;
  fileUri?: string; fileType?: string; fileName?: string; webFile?: any;
}): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('leave_type_code', args.code);
    formData.append('from_date', args.from);
    formData.append('to_date', args.to || args.from);
    formData.append('half_day_start', String(args.halfDay));
    if (args.category) formData.append('category', args.category);
    if (args.reason) formData.append('reason', args.reason);
    if (args.fileUri && args.fileType && args.fileName) {
      if (Platform.OS === 'web' && args.webFile) {
        formData.append('file', args.webFile);
      } else {
        formData.append('file', {
          uri: args.fileUri,
          type: args.fileType,
          name: args.fileName,
        } as any);
      }
    }

    const res = await authed('/api/v1/leave/request', {
      method: 'POST',
      body: formData,
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
  shiftDate: string; direction: PunchDirection; claimedAt: string; reason: string; category: string;
}): Promise<string | null> {
  try {
    const res = await authed('/api/v1/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shift_date: args.shiftDate, direction: args.direction,
        claimed_at: args.claimedAt, reason: args.reason, category: args.category,
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

/* ------------------------------------------------------------- enrolment */

export type EnrolmentStatus = {
  enrolled: boolean;
  pending: boolean;
  lastDecision: 'approved' | 'rejected' | null;
  lastNote: string | null;
};

function toEnrolmentStatus(j: Record<string, unknown>): EnrolmentStatus {
  return {
    enrolled: !!j.enrolled,
    pending: !!j.pending,
    lastDecision: (j.last_decision as EnrolmentStatus['lastDecision']) ?? null,
    lastNote: (j.last_note as string | null) ?? null,
  };
}

export async function getEnrolmentStatus(): Promise<EnrolmentStatus> {
  const res = await authed('/api/v1/mobile/enrolment');
  if (!res.ok) throw new Error(await detail(res, `Could not load enrolment (${res.status})`));
  return toEnrolmentStatus(await res.json());
}

/**
 * Offer your own photo as your reference photo. It goes PENDING until an
 * admin vouches that the face is yours - a photo nobody vouched for would
 * let anyone register a friend's face and hand them their attendance.
 * Quality problems (blur, two faces, no face) are refused right here with
 * the reason, so a doomed photo never wastes anyone's tap.
 */
export async function submitEnrolmentPhoto(photoUri: string): Promise<EnrolmentStatus> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photoUri)).blob();
    form.append('photo', blob, 'me.jpg');
  } else {
    form.append('photo', {
      uri: photoUri, name: 'me.jpg', type: 'image/jpeg',
    } as unknown as Blob);
  }
  const res = await authed('/api/v1/mobile/enrolment', { method: 'POST', body: form });
  if (!res.ok) throw new Error(await detail(res, `Could not submit (${res.status})`));
  return toEnrolmentStatus(await res.json());
}

export async function cancelEnrolmentPhoto(): Promise<EnrolmentStatus> {
  const res = await authed('/api/v1/mobile/enrolment', { method: 'DELETE' });
  if (!res.ok) throw new Error(await detail(res, `Could not cancel (${res.status})`));
  return toEnrolmentStatus(await res.json());
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
        data: n.data as Record<string, unknown> | undefined,
      }));
    }
    throw new Error(await detail(res, `Could not load notifications (${res.status})`));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not reach the server');
  }
}

export async function getHolidays(): Promise<Holiday[]> {
  try {
    const res = await authed('/api/v1/mobile/holidays');
    if (res.ok) return (await res.json()) as Holiday[];
    return [];
  } catch {
    return [];
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

/**
 * Answer a message from the inbox. The server works out who to deliver to
 * from the original notification, so the employee never names a recipient -
 * that is what keeps this a reply and not a messaging power.
 */
export async function replyToNotification(id: string, message: string): Promise<string | null> {
  try {
    const res = await authed(`/api/v1/notifications/${id}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return null;
    return detail(res, `Could not send the reply (${res.status})`);
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    return 'Could not reach the server - the reply was not sent';
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await authed(`/api/v1/notifications/${id}/read`, { method: 'POST' });
  } catch {
    // Fallback
  }
}

export async function uploadLeaveDocument(id: string, args: { fileUri: string; fileType: string; fileName: string; webFile?: any }): Promise<string | null> {
  try {
    const formData = new FormData();
    if (Platform.OS === 'web' && args.webFile) {
      formData.append('file', args.webFile);
    } else {
      formData.append('file', {
        uri: args.fileUri,
        type: args.fileType,
        name: args.fileName,
      } as any);
    }

    const res = await authed(`/api/v1/leave/${id}/document`, {
      method: 'POST',
      body: formData,
    });
    if (res.ok) return null;
    return detail(res, `Could not upload (${res.status})`);
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    return 'Could not reach the server - check your connection and try again';
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

export async function getWfhRequests(): Promise<WFHRequestItem[]> {
  try {
    const res = await authed('/api/v1/wfh');
    if (res.ok) {
      return (await res.json()) as WFHRequestItem[];
    }
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    console.error('getWfhRequests failed', err);
  }
  return [];
}

export async function submitWfhRequest(shiftDate: string, reason: string): Promise<string | null> {
  try {
    const res = await authed('/api/v1/wfh/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shift_date: shiftDate, reason }),
    });
    if (res.ok) return null;
    return detail(res, 'Could not submit request');
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    return 'Could not reach the server';
  }
}
