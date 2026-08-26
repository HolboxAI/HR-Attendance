export const API = process.env.NEXT_PUBLIC_API ?? 'http://127.0.0.1:8000';

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

/** Attendance changes as people punch, so nothing here is ever cached. */
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;      // API not running - the page says so rather than crashing
  }
}

export const getBoard = (on?: string) => get<Board>(`/api/v1/admin/board${on ? `?on=${on}` : ''}`);
export const getRejected = () => get<Rejected[]>('/api/v1/admin/rejected?days=7');
export const getMonth = (code: string, year: number, month: number) =>
  get<{ full_name: string; days: MonthDay[]; totals: Record<string, number> }>(
    `/api/v1/admin/month?employee_code=${code}&year=${year}&month=${month}`,
  );

export const IST = 'Asia/Kolkata';

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

export const getEnrolments = () => get<Enrolments>('/api/v1/admin/enrolments');

/** Cache-busted: after an upload the old photo is still the one on this URL. */
export const enrolmentPhotoUrl = (code: string, v: number) =>
  `${API}/api/v1/admin/enrolments/${code}/photo?v=${v}`;

export function dayMonth(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: IST,
  });
}
