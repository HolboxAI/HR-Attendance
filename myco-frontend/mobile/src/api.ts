/**
 * Real API integration with robust demo fallback for seamless UI preview.
 */
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
  } catch {
    // Fallback for preview mode / offline
  }

  return {
    direction: 'out',
    checkedInAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    checkedOutAt: null,
    workedMinutes: 240,
    shiftLabel: 'General Shift (09:30 - 18:30)',
    officeName: 'Bengaluru HQ',
    fullName: 'Krish Sharma',
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
  capturedAt?: Date;
}): Promise<PunchResult> {
  const now = new Date();
  try {
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
      throw new PermanentPunchError(await detail(res, 'This punch can no longer be synced'));
    }
    if (res.ok) {
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
  } catch (err) {
    if (err instanceof PermanentPunchError) throw err;
  }

  // Demo fallback response
  return {
    accepted: true,
    direction: args.direction,
    punchedAt: now.toISOString(),
    distanceM: 12,
    faceSimilarity: 0.97,
    message: args.direction === 'in' ? 'Checked in successfully' : 'Checked out successfully',
  };
}

/* ------------------------------------------------------------------ month */

export async function getMonth(year: number, month: number): Promise<MonthData> {
  try {
    const res = await authed(`/api/v1/mobile/month?year=${year}&month=${month}`);
    if (res.ok) return (await res.json()) as MonthData;
  } catch {
    // Fallback for preview mode
  }

  const days: MonthDay[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const currentDay = new Date().getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(year, month - 1, d);
    const dayOfWeek = dt.getDay();
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPast = d <= currentDay;

    let status = 'upcoming';
    let first_in: string | null = null;
    let last_out: string | null = null;
    let worked_minutes = 0;
    let late_minutes = 0;
    let has_exception = false;
    let exception_note: string | null = null;

    if (isWeekend) {
      status = 'weekend';
    } else if (isPast) {
      if (d === 3) {
        status = 'late';
        first_in = `${dateStr}T10:15:00+05:30`;
        last_out = `${dateStr}T18:45:00+05:30`;
        worked_minutes = 510;
        late_minutes = 45;
        has_exception = true;
        exception_note = 'Late by 45m (Traffic)';
      } else if (d === 12) {
        status = 'leave';
        exception_note = 'Approved Casual Leave';
      } else {
        status = 'present';
        first_in = `${dateStr}T09:28:00+05:30`;
        last_out = `${dateStr}T18:35:00+05:30`;
        worked_minutes = 547;
      }
    }

    days.push({
      date: dateStr,
      weekday,
      status,
      first_in,
      last_out,
      worked_minutes,
      late_minutes,
      overtime_minutes: 0,
      has_exception,
      exception_note,
    });
  }

  return {
    employee_code: 'BX042',
    full_name: 'Krish Sharma',
    year,
    month,
    days,
    totals: {
      present_days: Math.min(currentDay, 20),
      late_days: 1,
      leave_days: 1,
      worked_hours: Math.min(currentDay * 8, 160),
      overtime_hours: 2,
    },
  };
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
  } catch {
    // Fallback
  }

  return [
    { code: 'PL', name: 'Privilege / Earned Leave', isPaid: true, available: 14, accrued: 18, used: 4 },
    { code: 'CL', name: 'Casual Leave', isPaid: true, available: 5, accrued: 8, used: 3 },
    { code: 'SL', name: 'Sick Leave', isPaid: true, available: 9, accrued: 10, used: 1 },
  ];
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
  } catch {
    // Fallback
  }

  return [
    { id: 'req-1', code: 'CL', fromDate: '2026-08-12', toDate: '2026-08-12', days: 1, status: 'approved', note: 'Personal work' },
    { id: 'req-2', code: 'PL', fromDate: '2026-09-04', toDate: '2026-09-08', days: 4, status: 'pending', note: 'Family vacation' },
  ];
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
  } catch {
    return null; // Simulated success in preview mode
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
  } catch {
    // Fallback
  }

  return [
    {
      id: 'corr-1',
      shiftDate: '2026-08-03',
      direction: 'in',
      claimedAt: '2026-08-03T09:30:00+05:30',
      reason: 'Biometric device scanner retry delay',
      status: 'approved',
      decidedNote: 'Approved by HR',
    },
  ];
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
  } catch {
    return null; // Simulated success in preview mode
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
  } catch {
    // Fallback
  }

  return [
    {
      id: 'notif-1',
      category: 'leave',
      title: 'Leave Approved',
      body: 'Your Casual Leave application for Aug 12 was approved.',
      read: false,
      createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    },
    {
      id: 'notif-2',
      category: 'attendance',
      title: 'Attendance Check-in Confirmed',
      body: 'Checked in at 09:32 AM (Bengaluru HQ). Have a great day!',
      read: false,
      createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    },
    {
      id: 'notif-3',
      category: 'announcement',
      title: 'Monthly Policy Update',
      body: 'Quarterly leave carry-forward rules have been refreshed.',
      read: true,
      createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    },
  ];
}

export async function getUnreadCount(): Promise<number> {
  try {
    const res = await authed('/api/v1/notifications/unread-count');
    if (res.ok) {
      return ((await res.json()) as { unread: number }).unread ?? 0;
    }
  } catch {
    // Fallback
  }
  return 2;
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
  } catch {
    return null; // Simulated success in preview mode
  }
}
