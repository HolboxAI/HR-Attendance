import type { PunchDirection, PunchResult, SimulateCase, TodayStatus } from './types';

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

/** Stands in for auth until login exists. Matches emp_code in the seed. */
export const EMPLOYEE_CODE = 'BX001';

const OFFICE_NAME = 'Boxcode - IIMA Ventures';

let mockState: TodayStatus = {
  direction: 'in',
  checkedInAt: null,
  checkedOutAt: null,
  workedMinutes: 0,
  shiftLabel: '9:00 AM - 6:00 PM',
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hhmm(d: Date) {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export async function getToday(): Promise<TodayStatus> {
  if (USE_MOCK) {
    await wait(300);
    return { ...mockState };
  }
  const res = await fetch(
    `${API_BASE}/api/v1/mobile/me?employee_code=${encodeURIComponent(EMPLOYEE_CODE)}`,
  );
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
  form.append('employee_code', EMPLOYEE_CODE);

  const res = await fetch(`${API_BASE}/api/v1/mobile/punch`, { method: 'POST', body: form });
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
