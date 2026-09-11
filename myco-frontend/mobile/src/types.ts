export type PunchDirection = 'in' | 'out';

export type TodayStatus = {
  direction: PunchDirection;      // what the button will do next
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  lateMinutes: number;
  shiftLabel: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  officeName: string;
  fullName: string;
  employeeCode?: string;
};

export type PunchResult = {
  accepted: boolean;
  direction: PunchDirection;
  punchedAt: string;
  distanceM: number | null;
  faceSimilarity: number | null;
  message: string;
};

export type LeaveBalance = {
  code: string;
  name: string;
  isPaid: boolean;
  available: number;
  accrued: number;
  used: number;
  requiresProof: boolean;
};

export type LeaveRequestItem = {
  id: string;
  code: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'partially_approved';
  category?: string | null;
  note: string | null;
};

/* ===========================================================================
   frontend-main additions - shapes for the screens the old app never built.
   =========================================================================== */

export type MonthDay = {
  date: string;
  weekday: string;
  status: string;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  has_exception: boolean;
  exception_note: string | null;
};

export type MonthData = {
  employee_code: string;
  full_name: string;
  year: number;
  month: number;
  days: MonthDay[];
  totals: Record<string, number>;
};

export type CorrectionItem = {
  id: string;
  shiftDate: string;
  direction: PunchDirection;
  claimedAt: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decidedNote: string | null;
};

export type Holiday = {
  id: string;
  day: string;
  name: string;
  is_optional: boolean;
  is_confirmed: boolean;
};

export type NotificationItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown>;
};

export type WFHRequestItem = {
  id: string;
  shift_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
};
