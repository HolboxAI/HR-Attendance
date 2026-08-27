/**
 * The capability model, in one place.
 *
 * Mirrors RANK in apps/api/app/api/deps.py: roles STACK, each level includes
 * everything below it. The API is the security boundary - it refuses
 * regardless of what renders - so this file only decides what is worth
 * SHOWING someone. A hidden link protects nothing; a visible link to a page
 * that will 403 is just a broken promise.
 *
 * Derived from role rank rather than a role-string check per screen, so
 * activating the manager tier later is a data change, not a code hunt.
 */

export type Role = 'employee' | 'manager' | 'hr_admin' | 'super_admin';

const RANK: Record<Role, number> = {
  employee: 0,
  manager: 1,
  hr_admin: 2,
  super_admin: 3,
};

function rank(role: string): number {
  return RANK[role as Role] ?? 0;
}

export type Capabilities = {
  /** manager+ · attendance board, anyone's month, refused punches, CSV export */
  canViewBoard: boolean;
  /** manager+ · decide leave for visible employees, see team balances */
  canDecideLeave: boolean;
  /** hr_admin+ · decide correction requests, add punches directly */
  canDecideCorrections: boolean;
  /** hr_admin+ · leave policy, types, accrual, carry-forward, holidays, audit */
  canManageLeavePolicy: boolean;
  /** hr_admin+ · face enrolment */
  canManageEnrolment: boolean;
  /** hr_admin+ · device bindings, unbind a lost phone */
  canManageDevices: boolean;
  /** super_admin · reserved: no endpoint requires this today (PRD §1.2) */
  isSuperAdmin: boolean;
};

export function capabilitiesFor(role: string | undefined): Capabilities {
  const r = rank(role ?? 'employee');
  return {
    canViewBoard: r >= RANK.manager,
    canDecideLeave: r >= RANK.manager,
    canDecideCorrections: r >= RANK.hr_admin,
    canManageLeavePolicy: r >= RANK.hr_admin,
    canManageEnrolment: r >= RANK.hr_admin,
    canManageDevices: r >= RANK.hr_admin,
    isSuperAdmin: r >= RANK.super_admin,
  };
}

export function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    employee: 'Employee',
    manager: 'Manager',
    hr_admin: 'HR Admin',
    super_admin: 'Super Admin',
  };
  return labels[role] ?? role.replace('_', ' ');
}
