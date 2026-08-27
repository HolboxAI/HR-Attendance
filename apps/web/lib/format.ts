/**
 * Types and pure formatting, safe to import from client components.
 *
 * Kept separate from lib/api.ts because that file reads cookies via
 * next/headers, which cannot be bundled into browser code. A client component
 * importing a formatter must not drag the session machinery along with it.
 */

export const IST = 'Asia/Kolkata';

export type BoardRow = {
  employee_code: string;
  full_name: string;
  department: string | null;
  shift_label: string;
  status: string;
  currently_in: boolean;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  punch_count: number;
  has_exception: boolean;
  exception_note: string | null;
};

export type Board = {
  shift_date: string;
  summary: {
    present: number; late: number; absent: number; on_leave: number;
    weekly_off: number; exceptions: number; currently_in: number; headcount: number;
  };
  rows: BoardRow[];
};

export type Rejected = {
  employee_code: string; full_name: string; at: string;
  reason: string; distance_m: number | null; photo_key: string | null;
};

export type MonthDay = {
  date: string; weekday: string; status: string;
  first_in: string | null; last_out: string | null;
  worked_minutes: number; late_minutes: number; overtime_minutes: number;
  has_exception: boolean; exception_note: string | null;
};

export type EnrolmentRow = {
  employee_code: string;
  full_name: string;
  department: string | null;
  enrolled: boolean;
  enrolled_at: string | null;
  photo_count: number;
};

export type Enrolments = {
  summary: {
    headcount: number;
    enrolled: number;
    missing: number;
    enrolment_required: boolean;
    face_provider: string;
  };
  rows: EnrolmentRow[];
};

/**
 * Browser code never talks to the API directly - it has no token, by design.
 * Everything goes through the server-side proxy, which attaches one.
 */
export const proxy = (path: string) => `/api/gateway${path}`;

/** Cache-busted: after an upload the old photo is still the one on this URL. */
export const enrolmentPhotoUrl = (code: string, v: number) =>
  proxy(`/api/v1/admin/enrolments/${code}/photo?v=${v}`);

export function hhmm(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST,
  });
}

export function hours(min: number): string {
  if (!min) return '—';
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

export function dayMonth(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: IST,
  });
}

export type LeaveTypeRow = {
  id: string;
  code: string;
  name: string;
  annual_quota: number;
  accrual_rule: 'monthly' | 'annual' | 'none';
  carries_forward: boolean;
  carry_cap: number;
  is_paid: boolean;
  requires_proof: boolean;
  is_active: boolean;
};

export type LeavePolicyRow = {
  year_start_month: number;
  sandwich_rule: boolean;
  backdate_days: number;
};

export type LeaveRequestRow = {
  id: string;
  leave_type_code: string;
  leave_type_name: string;
  from_date: string;
  to_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
  days: number;
  status: string;
  reason: string | null;
  decided_note: string | null;
  decided_at: string | null;
  employee_code: string | null;
  employee_name: string | null;
};

export type BalanceRow = {
  leave_type_id: string;
  code: string;
  name: string;
  is_paid: boolean;
  period: string;
  opening: number;
  accrued: number;
  used: number;
  available: number;
};

export type HolidayRow = {
  id: string;
  day: string;
  name: string;
  is_optional: boolean;
  is_confirmed: boolean;
  note: string | null;
};

export type AuditRow = {
  at: string;
  actor: string;
  entity: string;
  action: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  note: string | null;
};

export const LEAVE_STATUS: Record<string, { label: string; glyph: string; tone: string }> = {
  pending:   { label: 'Pending',   glyph: '◌', tone: 'text-st-late' },
  approved:  { label: 'Approved',  glyph: '●', tone: 'text-st-present' },
  rejected:  { label: 'Rejected',  glyph: '○', tone: 'text-st-absent' },
  cancelled: { label: 'Cancelled', glyph: '–', tone: 'text-ink-3' },
};

/** "8 Aug" / "8–12 Aug 2026" - a date range people can read at a glance. */
export function dateRange(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (from === to) {
    return f.toLocaleDateString('en-IN', { ...opts, year: 'numeric' });
  }
  return `${f.toLocaleDateString('en-IN', opts)} – ${t.toLocaleDateString('en-IN', { ...opts, year: 'numeric' })}`;
}

export function plainDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export type CorrectionRow = {
  id: string;
  shift_date: string;
  direction: string;
  claimed_at: string;
  reason: string;
  status: string;
  decided_note: string | null;
  decided_at: string | null;
  employee_code: string | null;
  employee_name: string | null;
};
