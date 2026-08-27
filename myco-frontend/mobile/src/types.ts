export type PunchDirection = 'in' | 'out';

export type TodayStatus = {
  direction: PunchDirection;      // what the button will do next
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  shiftLabel: string;
  officeName: string;
  fullName: string;
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
};

export type LeaveRequestItem = {
  id: string;
  code: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
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

export type NotificationItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};
