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
