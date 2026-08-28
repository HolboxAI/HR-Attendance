/**
 * Server-side data access. Every call carries the signed-in user's token, so
 * the API decides what this person may see - the dashboard does not filter on
 * its own and cannot be talked out of it by editing a URL.
 *
 * Grouped by domain to mirror the API surface. Client components never import
 * this file (it reads cookies via next/headers); they go through /api/gateway.
 */
import { apiFetch, apiGet } from '@/lib/session';

export * from '@/lib/format';
import type {
  AuditRow, BalanceRow, Board, CorrectionRow, DeviceRow, Enrolments, HolidayRow,
  LeavePolicyRow, LeaveRequestRow, LeaveTypeRow, MonthResponse, NotificationRow,
  Rejected, TeamBalanceRow,
} from '@/lib/format';

/* ------------------------------------------------------------------ board */

export const getBoard = (on?: string) =>
  apiFetch<Board>(`/api/v1/admin/board${on ? `?on=${on}` : ''}`);

export const getRejected = (days = 7) =>
  apiGet<Rejected[]>(`/api/v1/admin/rejected?days=${days}`);

export const getMonth = (code: string, year: number, month: number) =>
  apiGet<MonthResponse>(
    `/api/v1/admin/month?employee_code=${encodeURIComponent(code)}&year=${year}&month=${month}`,
  );

/** Your own month - not an admin route, so every employee can reach it. */
export const getMyMonth = (year: number, month: number) =>
  apiGet<MonthResponse>(`/api/v1/mobile/month?year=${year}&month=${month}`);

/* -------------------------------------------------------------- enrolment */

export const getEnrolments = () => apiGet<Enrolments>('/api/v1/admin/enrolments');

export const getEnrolmentRequests = () =>
  apiGet<import('@/components/PendingEnrolments').EnrolmentRequestRow[]>(
    '/api/v1/admin/enrolments/requests',
  );

/* ------------------------------------------------------------------ leave */

export const getLeavePolicy = () => apiFetch<LeavePolicyRow>('/api/v1/admin/leave/policy');
export const getLeaveTypes = () => apiFetch<LeaveTypeRow[]>('/api/v1/admin/leave/types');
export const getLeaveAudit = (limit = 80) =>
  apiGet<AuditRow[]>(`/api/v1/admin/leave/audit?limit=${limit}`);
export const getPending = () => apiFetch<LeaveRequestRow[]>('/api/v1/admin/leave/pending');
export const getTeamBalances = () =>
  apiFetch<TeamBalanceRow[]>('/api/v1/admin/leave/balances');
export const getHolidays = (year: number) =>
  apiGet<HolidayRow[]>(`/api/v1/admin/holidays?year=${year}`);

/** Mine - reachable by every employee, not an admin route. */
export const getMyBalance = () => apiGet<BalanceRow[]>('/api/v1/leave/balance');
export const getMyRequests = () => apiGet<LeaveRequestRow[]>('/api/v1/leave/my-requests');
export const getMyLeaveTypes = () => apiGet<LeaveTypeRow[]>('/api/v1/leave/types');

/* ------------------------------------------------------------ corrections */

export const getCorrectionsPending = () =>
  apiFetch<CorrectionRow[]>('/api/v1/admin/corrections/pending');

export const getMyCorrections = () =>
  apiGet<CorrectionRow[]>('/api/v1/corrections/my-requests');

/* ---------------------------------------------------------------- devices */

export const getDevices = () => apiFetch<DeviceRow[]>('/api/v1/admin/devices');

/* ---------------------------------------------------------- notifications */

export const getNotifications = (unreadOnly = false) =>
  apiGet<NotificationRow[]>(`/api/v1/notifications${unreadOnly ? '?unread_only=true' : ''}`);

export const getUnreadCount = async (): Promise<number> => {
  const r = await apiGet<{ unread: number }>('/api/v1/notifications/unread-count');
  return r?.unread ?? 0;
};
