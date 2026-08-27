import { authHeaders, signOut } from './session';
import type {
  LeaveBalance, LeaveRequestItem, PunchDirection, PunchResult, SimulateCase, TodayStatus,
} from './types';

/**
 * Two implementations behind one interface.
 *
 * MOCK is not a throwaway: it returns the same shapes the FastAPI endpoint
 * returns, including every rejection path. That means the whole screen -
 * success, "you're too far", face mismatch, offline queueing - can be built
 * and demoed before the server exists, and swapping to the real API is one
 * constant.
 */
/**
 * Flip this to false to talk to the API running on your laptop.
 *
 * API_BASE must be your machine's LAN address, not localhost - localhost on a
 * phone means the phone. Find it with `ipconfig getifaddr en0` on macOS, and
 * start the API bound to all interfaces:
 *
 *     .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
 *
 * Phone and laptop must be on the same WiFi.
 */
export const USE_MOCK = true;
export const API_BASE = 'http://192.168.1.10:8000';

/*
 * There is deliberately no EMPLOYEE_CODE constant here any more.
 *
 * It used to decide who you were, which meant anyone could edit one line and
 * punch as a colleague. Identity now comes from the access token, and the
 * punch endpoint has no employee parameter at all - so there is nothing to
 * put back even if someone wanted to.
 */

const OFFICE_NAME = 'Boxcode - IIMA Ventures';

let mockState: TodayStatus = {
  direction: 'in',
  checkedInAt: null,
  checkedOutAt: null,
  workedMinutes: 0,
  shiftLabel: '9:00 AM - 6:00 PM',
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The server refused this punch and always will. Stop retrying it. */
export class PermanentPunchError extends Error {}

function hhmm(d: Date) {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export async function getToday(): Promise<TodayStatus> {
  if (USE_MOCK) {
    await wait(300);
    return { ...mockState };
  }
  const res = await fetch(`${API_BASE}/api/v1/mobile/me`, {
    headers: await authHeaders(),
  });
  if (res.status === 401) {
    await signOut();
    throw new Error('Session expired - sign in again');
  }
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  const j = await res.json();
  return {
    direction: j.direction,
    checkedInAt: j.checked_in_at,
    checkedOutAt: j.checked_out_at,
    workedMinutes: j.worked_minutes,
    shiftLabel: j.shift_label,
  };
}

export async function submitPunch(args: {
  photoUri: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  isMocked: boolean;
  direction: PunchDirection;
  simulate?: SimulateCase;
  /**
   * Only set when replaying a punch that was queued offline. Its presence
   * tells the server "this happened earlier than it arrived"; the server
   * bounds how far back it will believe.
   */
  capturedAt?: Date;
}): Promise<PunchResult> {
  const now = new Date();

  if (USE_MOCK) {
    await wait(1400);   // roughly what Rekognition + a round trip costs
    const base = {
      direction: args.direction,
      punchedAt: now.toISOString(),
      faceSimilarity: null as number | null,
      distanceM: null as number | null,
    };

    switch (args.simulate) {
      case 'too_far':
        return { ...base, accepted: false, distanceM: 412,
          message: "You're about 412m from the office - check in from inside" };
      case 'mock_gps':
        return { ...base, accepted: false, message: 'Mock location detected' };
      case 'wrong_wifi':
        return { ...base, accepted: false,
          message: 'Connect to the office WiFi to check in' };
      case 'face_mismatch':
        return { ...base, accepted: false, faceSimilarity: 41.2,
          message: 'Face does not match the enrolled photo' };
      case 'no_signal':
        throw new Error('offline');
      default: {
        // Mirror what the resolver would do, so the UI is honest.
        if (args.direction === 'in') {
          mockState = { ...mockState, direction: 'out', checkedInAt: hhmm(now) };
        } else {
          const inAt = mockState.checkedInAt ?? hhmm(now);
          mockState = { ...mockState, direction: 'in', checkedOutAt: hhmm(now),
            workedMinutes: 8 * 60 + 12, checkedInAt: inAt };
        }
        return { ...base, accepted: true, distanceM: 18, faceSimilarity: 98.4,
          message: args.direction === 'in'
            ? `Checked in at ${hhmm(now)}`
            : `Checked out at ${hhmm(now)}` };
      }
    }
  }

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

  const res = await fetch(`${API_BASE}/api/v1/mobile/punch`, {
    method: 'POST',
    body: form,
    headers: await authHeaders(),
  });
  if (res.status === 401) {
    await signOut();
    throw new Error('Session expired - sign in again');
  }
  if (res.status === 422) {
    // Too old to sync. The server has refused it for good; surface the reason
    // rather than retrying this punch until the end of time.
    const body = await res.json().catch(() => null);
    throw new PermanentPunchError(body?.detail ?? 'This punch can no longer be synced');
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

export function resetMock() {
  mockState = { direction: 'in', checkedInAt: null, checkedOutAt: null,
    workedMinutes: 0, shiftLabel: '9:00 AM - 6:00 PM' };
}

export { OFFICE_NAME };

/* ---------------------------------------------------------------------------
 * Leave
 * ------------------------------------------------------------------------ */

const MOCK_BALANCES: LeaveBalance[] = [
  { code: 'CL', name: 'Casual Leave', isPaid: true, available: 8, accrued: 8, used: 0 },
  { code: 'SL', name: 'Sick Leave', isPaid: true, available: 4, accrued: 4, used: 0 },
  { code: 'EL', name: 'Earned Leave', isPaid: true, available: 10, accrued: 10, used: 0 },
];
let mockRequests: LeaveRequestItem[] = [];

export async function getLeaveBalance(): Promise<LeaveBalance[]> {
  if (USE_MOCK) {
    await wait(250);
    return MOCK_BALANCES;
  }
  const res = await fetch(`${API_BASE}/api/v1/leave/balance`, {
    headers: await authHeaders(),
  });
  if (res.status === 401) { await signOut(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(`balance failed: ${res.status}`);
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
  if (USE_MOCK) {
    await wait(250);
    return [...mockRequests];
  }
  const res = await fetch(`${API_BASE}/api/v1/leave/my-requests`, {
    headers: await authHeaders(),
  });
  if (res.status === 401) { await signOut(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(`requests failed: ${res.status}`);
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
  if (USE_MOCK) {
    await wait(400);
    mockRequests = [{
      id: String(mockRequests.length + 1), code: args.code, fromDate: args.from,
      toDate: args.to || args.from, days: 1, status: 'pending', note: args.reason || null,
    }, ...mockRequests];
    return null;
  }
  const res = await fetch(`${API_BASE}/api/v1/leave/request`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leave_type_code: args.code, from_date: args.from, to_date: args.to || args.from,
      half_day_start: args.halfDay, reason: args.reason || null,
    }),
  });
  if (res.status === 401) { await signOut(); return 'Session expired - sign in again'; }
  if (res.ok) return null;
  // The API refuses with the numbers in it - how many days you have, what
  // clashes. Passing that straight through is more use than "failed".
  const body = await res.json().catch(() => null);
  return body?.detail ?? `Could not apply (${res.status})`;
}

export async function cancelLeave(id: string): Promise<void> {
  if (USE_MOCK) {
    mockRequests = mockRequests.map((r) =>
      (r.id === id ? { ...r, status: 'cancelled' as const } : r));
    return;
  }
  await fetch(`${API_BASE}/api/v1/leave/${id}/cancel`, {
    method: 'POST', headers: await authHeaders(),
  });
}
