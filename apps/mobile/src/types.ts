export type PunchDirection = 'in' | 'out';

export type TodayStatus = {
  direction: PunchDirection;      // what the button will do next
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  shiftLabel: string;
};

export type PunchResult = {
  accepted: boolean;
  direction: PunchDirection;
  punchedAt: string;
  distanceM: number | null;
  faceSimilarity: number | null;
  message: string;
};

/** Dev-only. Lets us demo every rejection path without driving to the car park. */
export type SimulateCase =
  | 'success'
  | 'too_far'
  | 'mock_gps'
  | 'wrong_wifi'
  | 'face_mismatch'
  | 'no_signal';

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
