/**
 * Server-side data access. Every call carries the signed-in user's token, so
 * the API decides what this person may see - the dashboard does not filter on
 * its own and cannot be talked out of it by editing a URL.
 */
import { apiFetch, apiGet } from '@/lib/session';

export * from '@/lib/format';
import type { Board, Enrolments, MonthDay, Rejected } from '@/lib/format';

export const getBoard = (on?: string) =>
  apiFetch<Board>(`/api/v1/admin/board${on ? `?on=${on}` : ''}`);

export const getRejected = () => apiGet<Rejected[]>('/api/v1/admin/rejected?days=7');

export const getMonth = (code: string, year: number, month: number) =>
  apiGet<{ full_name: string; days: MonthDay[]; totals: Record<string, number> }>(
    `/api/v1/admin/month?employee_code=${code}&year=${year}&month=${month}`,
  );

export const getEnrolments = () => apiGet<Enrolments>('/api/v1/admin/enrolments');

/** Your own month - not an admin route, so every employee can reach it. */
export const getMyMonth = (year: number, month: number) =>
  apiGet<{ employee_code: string; full_name: string; days: MonthDay[];
           totals: Record<string, number> }>(
    `/api/v1/mobile/month?year=${year}&month=${month}`,
  );

import type {
  AuditRow, BalanceRow, HolidayRow, LeavePolicyRow, LeaveRequestRow, LeaveTypeRow,
} from '@/lib/format';

export const getLeavePolicy = () => apiFetch<LeavePolicyRow>('/api/v1/admin/leave/policy');
export const getLeaveTypes = () => apiFetch<LeaveTypeRow[]>('/api/v1/admin/leave/types');
export const getLeaveAudit = () => apiGet<AuditRow[]>('/api/v1/admin/leave/audit?limit=40');
export const getPending = () => apiFetch<LeaveRequestRow[]>('/api/v1/admin/leave/pending');
export const getHolidays = (year: number) =>
  apiGet<HolidayRow[]>(`/api/v1/admin/holidays?year=${year}`);

/** Mine - reachable by every employee, not an admin route. */
export const getMyBalance = () => apiGet<BalanceRow[]>('/api/v1/leave/balance');
export const getMyRequests = () => apiGet<LeaveRequestRow[]>('/api/v1/leave/my-requests');
export const getMyLeaveTypes = () => apiGet<LeaveTypeRow[]>('/api/v1/leave/types');
