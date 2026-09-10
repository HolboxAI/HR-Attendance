'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Phone,
  Shield,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { HoverProfile } from '@/components/HoverProfile';
import { HolboxSearch } from '@/components/HolboxSearch';
import { Status } from '@/components/Status';
import type { PendingSignup, SignupsData } from '@/lib/api';

export type DirectoryRow = {
  code: string;
  name: string;
  department: string | null;
  shift: string;
  status: string;
  currentlyIn: boolean;
  enrolled: boolean | null;   // null = viewer can't see enrolment (not HR)
  deviceBound: boolean | null; // null = viewer can't see devices (not HR)
};

interface DirectoryProps {
  rows: DirectoryRow[];
  canDelete?: boolean;
  currentEmployeeCode?: string | null;
  signupsData?: SignupsData;
}

export function Directory({
  rows,
  canDelete = false,
  currentEmployeeCode = null,
  signupsData,
}: DirectoryProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const approvalDialogRef = useRef<HTMLDialogElement>(null);

  const [localRows, setLocalRows] = useState<DirectoryRow[]>(rows);
  const [query, setQuery] = useState('');
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  // Deletion modal state
  const [deleteTarget, setDeleteTarget] = useState<DirectoryRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  // Pending signups state
  const [pendingSignups, setPendingSignups] = useState<PendingSignup[]>(
    signupsData?.requests ?? []
  );
  const [activeSignup, setActiveSignup] = useState<PendingSignup | null>(null);

  // Approval form state
  const [assignCode, setAssignCode] = useState(signupsData?.suggested_emp_code ?? '');
  const [assignDept, setAssignDept] = useState('');
  const [assignShift, setAssignShift] = useState(signupsData?.shifts?.[0] ?? '');
  const [assignDesignation, setAssignDesignation] = useState('');
  const [assignRole, setAssignRole] = useState('employee');
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    if (signupsData?.requests) {
      setPendingSignups(signupsData.requests);
    }
  }, [signupsData]);

  useEffect(() => {
    if (activeSignup) {
      setAssignCode(signupsData?.suggested_emp_code ?? 'BX012');
      setAssignDept(activeSignup.desired_department ?? (signupsData?.departments?.[0] ?? ''));
      setAssignShift(signupsData?.shifts?.[0] ?? 'Morning Shift');
      setAssignDesignation(activeSignup.desired_designation ?? '');
      setAssignRole('employee');
      setApprovalError(null);
    }
  }, [activeSignup, signupsData]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (deleteTarget && !d.open) {
      d.showModal();
    } else if (!deleteTarget && d.open) {
      d.close();
    }
  }, [deleteTarget]);

  useEffect(() => {
    const d = approvalDialogRef.current;
    if (!d) return;
    if (activeSignup && !d.open) {
      d.showModal();
    } else if (!activeSignup && d.open) {
      d.close();
    }
  }, [activeSignup]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return localRows;
    return localRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q),
    );
  }, [localRows, query]);

  const showHrColumns = localRows.some((r) => r.enrolled !== null || r.deviceBound !== null);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/gateway/api/v1/admin/employees/${deleteTarget.code}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDeleteError(data.detail ?? 'Failed to delete employee.');
        setIsDeleting(false);
        return;
      }

      // Remove from local list immediately
      setLocalRows((prev) => prev.filter((r) => r.code !== deleteTarget.code));
      setDeleteSuccess(
        data.message ?? `Employee ${deleteTarget.name} (${deleteTarget.code}) and all data deleted.`
      );
      setDeleteTarget(null);
      router.refresh();

      setTimeout(() => {
        setDeleteSuccess(null);
      }, 6000);
    } catch (err: any) {
      setDeleteError(err.message ?? 'An unexpected network error occurred.');
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleApproveSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSignup) return;
    setIsApproving(true);
    setApprovalError(null);

    try {
      const res = await fetch(`/api/gateway/api/v1/admin/signups/${activeSignup.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emp_code: assignCode.trim().toUpperCase(),
          department: assignDept.trim() || null,
          shift: assignShift.trim() || null,
          designation: assignDesignation.trim() || null,
          role: assignRole,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApprovalError(data.detail ?? 'Failed to approve signup request');
        setIsApproving(false);
        return;
      }

      // Add to local rows
      const emp = data.employee;
      if (emp) {
        setLocalRows((prev) => [
          {
            code: emp.emp_code,
            name: emp.full_name,
            department: emp.department,
            shift: assignShift || 'Morning Shift',
            status: 'not_marked',
            currentlyIn: false,
            enrolled: false,
            deviceBound: false,
          },
          ...prev,
        ]);
      }

      // Remove from pending list
      setPendingSignups((prev) => prev.filter((s) => s.id !== activeSignup.id));
      setActionSuccess(`🎉 ${activeSignup.full_name} (${assignCode.toUpperCase()}) added to workforce! They can now sign in.`);
      setActiveSignup(null);
      router.refresh();

      setTimeout(() => {
        setActionSuccess(null);
      }, 6000);
    } catch {
      setApprovalError('Network error while approving employee');
    } finally {
      setIsApproving(false);
    }
  }

  async function handleRejectSignup(signupId: string, name: string) {
    if (!confirm(`Are you sure you want to decline registration for ${name}?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/gateway/api/v1/admin/signups/${signupId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Declined by administrator' }),
      });
      if (res.ok) {
        setPendingSignups((prev) => prev.filter((s) => s.id !== signupId));
        setActionSuccess(`Registration request for ${name} was declined.`);
        setTimeout(() => setActionSuccess(null), 4000);
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4 fade-in-up">
      {/* Action Success Notification Banner */}
      {actionSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="flex-1">{actionSuccess}</span>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="p-1 rounded-lg hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Delete Success Notification Banner */}
      {deleteSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="flex-1">{deleteSuccess}</span>
          <button
            type="button"
            onClick={() => setDeleteSuccess(null)}
            className="p-1 rounded-lg hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Pending Signups Banner */}
      {pendingSignups.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-5 shadow-lg shadow-emerald-500/5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full size-2.5 bg-emerald-500"></span>
              </span>
              <h3 className="font-display text-sm font-bold text-ink flex items-center gap-2">
                Pending Registration Requests
                <span className="rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-mono font-semibold">
                  {pendingSignups.length}
                </span>
              </h3>
            </div>
            <span className="text-[11px] font-mono text-ink-3 hidden sm:inline">
              New joiners waiting for Admin review &amp; assignment
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {pendingSignups.map((su) => (
              <div
                key={su.id}
                className="rounded-xl border border-line bg-surface/80 p-3.5 flex flex-col justify-between gap-3 shadow-sm hover:border-emerald-500/40 transition-colors"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={su.full_name} />
                      <span className="text-sm font-bold text-ink">{su.full_name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-ink-3">
                      {su.created_at ? new Date(su.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'New'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-surface-2 px-2 py-0.5 rounded-md border border-line">
                      <Mail className="size-3 text-ink-3" />
                      {su.email}
                    </span>
                    {su.phone && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-surface-2 px-2 py-0.5 rounded-md border border-line">
                        <Phone className="size-3 text-ink-3" />
                        {su.phone}
                      </span>
                    )}
                    {su.desired_department && (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-md border border-emerald-500/20">
                        <Building2 className="size-3" />
                        {su.desired_department}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-line/40">
                  <button
                    type="button"
                    onClick={() => setActiveSignup(su)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white py-1.5 px-3 text-xs font-semibold shadow-xs transition-all cursor-pointer"
                  >
                    <UserPlus className="size-3.5" />
                    <span>Review &amp; Add as Employee</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectSignup(su.id, su.full_name)}
                    className="rounded-xl border border-line hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 p-1.5 text-xs text-ink-3 transition-colors cursor-pointer"
                    title="Decline registration request"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <HolboxSearch
            variant="directory"
            people={localRows.map((r) => ({ code: r.code, name: r.name, department: r.department }))}
            onQueryChange={setQuery}
            placeholders={[
              'Search a name — Himesh, Krish...',
              'Search a code — BX002...',
              'Search a department — Engineering...',
            ]}
          />
        </div>
        <span className="text-xs font-mono text-ink-3">
          Showing <strong className="text-ink">{filtered.length}</strong> of {localRows.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl px-6 py-10 text-center text-sm text-ink-3 font-mono">
          No team members match this search criteria.
        </div>
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto glass-panel rounded-2xl md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
                  <th className="px-5 py-3.5 font-semibold">Employee</th>
                  <th className="px-5 py-3.5 font-semibold">Shift</th>
                  <th className="px-5 py-3.5 font-semibold">Today</th>
                  {showHrColumns && <th className="px-5 py-3.5 font-semibold">Biometrics</th>}
                  {showHrColumns && <th className="px-5 py-3.5 font-semibold">Handset Device</th>}
                  {canDelete && <th className="px-5 py-3.5 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody
                onMouseLeave={() => setHoveredCode(null)}
                className="divide-y divide-line/30"
              >
                {filtered.map((r) => {
                  const isHovered = hoveredCode === r.code;
                  const isDimmed = hoveredCode !== null && !isHovered;
                  const isSelf = currentEmployeeCode === r.code;

                  return (
                    <tr
                      key={r.code}
                      onMouseEnter={() => setHoveredCode(r.code)}
                      style={{
                        opacity: isDimmed ? 0.25 : 1,
                        transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                      className={`group cursor-pointer transition-all duration-300 ${
                        isHovered ? 'bg-surface-2/80' : 'hover:bg-surface-2/40'
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <HoverProfile data={{ name: r.name, code: r.code, department: r.department }} className="block">
                          <Link href={`/people/${r.code}`} className="flex items-center gap-3">
                            <span className="relative shrink-0">
                              <Avatar name={r.name} />
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                                  r.currentlyIn ? 'bg-accent shadow-sm bx-pulse' : 'bg-line'
                                }`}
                                aria-hidden
                              />
                            </span>
                            <span className="inline-block transition-transform duration-300 group-hover:translate-x-3">
                              <span className="flex items-center gap-1.5 font-semibold text-ink group-hover:text-accent transition-colors">
                                {r.name}
                                {r.currentlyIn && <span className="sr-only"> (currently in the office)</span>}
                                <ArrowUpRight className="size-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-ink shrink-0" aria-hidden />
                              </span>
                              <span className="block text-xs font-mono text-ink-3">
                                {r.code}{r.department ? ` · ${r.department}` : ''}
                              </span>
                            </span>
                          </Link>
                        </HoverProfile>
                      </td>
                      <td className="tnum px-5 py-3.5 font-mono text-xs text-ink-3">{r.shift}</td>
                      <td className="px-5 py-3.5"><Status value={r.status} /></td>
                      {showHrColumns && (
                        <td className="px-5 py-3.5 text-xs font-mono">
                          {r.enrolled === null ? '—' : r.enrolled
                            ? <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-st-present/15 text-st-present border border-st-present/25 font-medium"><span className="size-1.5 rounded-full bg-current" />Enrolled</span>
                            : <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-st-late/15 text-st-late border border-st-late/25 font-medium"><span className="size-1.5 rounded-full bg-current" />No photo</span>}
                        </td>
                      )}
                      {showHrColumns && (
                        <td className="px-5 py-3.5 text-xs font-mono">
                          {r.deviceBound === null ? '—' : r.deviceBound
                            ? <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-st-present/15 text-st-present border border-st-present/25 font-medium"><span className="size-1.5 rounded-full bg-current" />Bound</span>
                            : <span className="text-ink-3 font-medium">None</span>}
                        </td>
                      )}
                      {canDelete && (
                        <td className="px-5 py-3.5 text-right">
                          {isSelf ? (
                            <span className="text-[11px] font-mono text-ink-3 italic select-none">
                              (You)
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteError(null);
                                setDeleteTarget(r);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 active:scale-95 transition-all cursor-pointer border border-transparent hover:border-rose-500/20"
                              title={`Delete employee ${r.name} (${r.code})`}
                            >
                              <Trash2 className="size-3.5" />
                              <span>Delete</span>
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Narrow: cards */}
          <div
            onMouseLeave={() => setHoveredCode(null)}
            className="grid gap-2.5 md:hidden"
          >
            {filtered.map((r) => {
              const isHovered = hoveredCode === r.code;
              const isDimmed = hoveredCode !== null && !isHovered;
              const isSelf = currentEmployeeCode === r.code;

              return (
                <div
                  key={r.code}
                  onMouseEnter={() => setHoveredCode(r.code)}
                  style={{
                    opacity: isDimmed ? 0.25 : 1,
                    transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  className={`group glass-panel flex items-center justify-between gap-3 p-4 rounded-2xl transition-all duration-300 ${
                    isDimmed ? 'scale-[0.98]' : 'scale-100 hover:bg-surface-2/60'
                  }`}
                >
                  <Link
                    href={`/people/${r.code}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <HoverProfile data={{ name: r.name, code: r.code, department: r.department }} className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="relative shrink-0">
                        <Avatar name={r.name} />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface ${
                            r.currentlyIn ? 'bg-accent' : 'bg-line'
                          }`}
                          aria-hidden
                        />
                      </span>
                      <span className="min-w-0 flex-1 transition-transform duration-300 group-hover:translate-x-2.5">
                        <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                        <span className="block text-xs font-mono text-ink-3">
                          {r.code}{r.department ? ` · ${r.department}` : ''}
                        </span>
                      </span>
                    </HoverProfile>
                  </Link>

                  <div className="flex items-center gap-2 shrink-0">
                    <Status value={r.status} size="xs" />
                    {canDelete && !isSelf && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteError(null);
                          setDeleteTarget(r);
                        }}
                        className="p-1.5 rounded-lg text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 active:scale-95 transition-all cursor-pointer border border-transparent hover:border-rose-500/20"
                        title={`Delete ${r.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Native Confirmation Dialog - renders directly in browser Top Layer, perfectly centered */}
      <dialog
        ref={dialogRef}
        onClose={() => {
          if (!isDeleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onCancel={(e) => {
          if (isDeleting) e.preventDefault();
          else {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        className="bx-pop m-auto w-full max-w-md rounded-2xl border border-line glass-panel p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-md overflow-hidden bg-surface"
      >
        {deleteTarget && (
          <div className="p-6 space-y-5">
            {/* Header Icon & Close */}
            <div className="flex items-start justify-between">
              <div className="size-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shadow-sm">
                <Trash2 className="size-6" />
              </div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  if (!isDeleting) {
                    setDeleteTarget(null);
                    setDeleteError(null);
                  }
                }}
                className="p-1.5 rounded-xl text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Title & Question */}
            <div className="space-y-1.5">
              <h3 className="font-display text-lg font-bold text-ink">
                Delete Employee Permanently?
              </h3>
              <p className="text-sm text-ink-2">
                Are you sure you want to delete <strong className="text-ink">{deleteTarget.name}</strong> (<span className="font-mono text-xs font-semibold">{deleteTarget.code}</span>)?
              </p>
            </div>

            {/* Warning Note Box */}
            <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs leading-relaxed space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                <span>Permanent Deletion Warning</span>
              </div>
              <p className="text-[11px] opacity-90 leading-normal text-ink-2">
                If you delete this employee, <strong>all history of this employee and data will be deleted as well</strong> — including attendance records, punch events, biometric reference photos, device bindings, leave requests &amp; balances, and login credentials.
              </p>
              <p className="text-[11px] font-semibold text-rose-500">
                This action is irreversible and cannot be undone.
              </p>
            </div>

            {/* Error Message */}
            {deleteError && (
              <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium">
                {deleteError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2.5 rounded-xl border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 disabled:opacity-60 cursor-pointer flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Deleting Everything…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="size-3.5" />
                    <span>Yes, Delete Everything</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </dialog>

      {/* Review & Approve Signup Modal */}
      <dialog
        ref={approvalDialogRef}
        onClose={() => setActiveSignup(null)}
        onClick={(e) => {
          if (e.target === approvalDialogRef.current && !isApproving) {
            setActiveSignup(null);
          }
        }}
        className="fixed inset-0 m-auto z-50 p-0 max-w-lg w-[calc(100%-2rem)] rounded-3xl border border-line/80 bg-surface/95 backdrop-blur-2xl shadow-2xl text-ink outline-none backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        {activeSignup && (
          <form onSubmit={handleApproveSignup} className="p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between gap-3 border-b border-line/50 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
                  <UserPlus className="size-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    Review &amp; Add Employee
                  </h3>
                  <p className="text-xs text-ink-3">
                    Assign code, department, and shift to activate account.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveSignup(null)}
                className="p-1.5 rounded-xl border border-line text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Candidate Info (Readonly) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl bg-surface-2/60 border border-line/50">
                <div>
                  <span className="text-[10px] font-mono text-ink-3 uppercase block">Candidate Name</span>
                  <span className="font-semibold text-ink text-sm">{activeSignup.full_name}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-ink-3 uppercase block">Email Address</span>
                  <span className="font-mono text-ink">{activeSignup.email}</span>
                </div>
                {activeSignup.phone && (
                  <div>
                    <span className="text-[10px] font-mono text-ink-3 uppercase block">Phone</span>
                    <span className="font-mono text-ink">{activeSignup.phone}</span>
                  </div>
                )}
                {activeSignup.desired_department && (
                  <div>
                    <span className="text-[10px] font-mono text-ink-3 uppercase block">Requested Dept</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{activeSignup.desired_department}</span>
                  </div>
                )}
              </div>

              {/* Assignment Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-mono font-medium text-ink-2">
                    Employee Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={assignCode}
                    onChange={(e) => setAssignCode(e.target.value)}
                    placeholder="e.g. BX012"
                    className="w-full rounded-xl bg-surface border border-line px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:border-accent"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-mono font-medium text-ink-2">
                    System Role *
                  </label>
                  <select
                    value={assignRole}
                    onChange={(e) => setAssignRole(e.target.value)}
                    className="w-full rounded-xl bg-surface border border-line px-3 py-2 text-xs font-semibold text-ink focus:outline-none focus:border-accent"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="hr_admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-mono font-medium text-ink-2">
                    Department
                  </label>
                  <select
                    value={assignDept}
                    onChange={(e) => setAssignDept(e.target.value)}
                    className="w-full rounded-xl bg-surface border border-line px-3 py-2 text-xs font-semibold text-ink focus:outline-none focus:border-accent"
                  >
                    <option value="">Select Department...</option>
                    {signupsData?.departments?.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-mono font-medium text-ink-2">
                    Shift Template
                  </label>
                  <select
                    value={assignShift}
                    onChange={(e) => setAssignShift(e.target.value)}
                    className="w-full rounded-xl bg-surface border border-line px-3 py-2 text-xs font-semibold text-ink focus:outline-none focus:border-accent"
                  >
                    <option value="">Select Shift...</option>
                    {signupsData?.shifts?.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-mono font-medium text-ink-2">
                  Designation / Title
                </label>
                <input
                  type="text"
                  value={assignDesignation}
                  onChange={(e) => setAssignDesignation(e.target.value)}
                  placeholder="e.g. AI Engineer"
                  className="w-full rounded-xl bg-surface border border-line px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent"
                />
              </div>

              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11px] leading-relaxed flex items-start gap-2">
                <Sparkles className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                <span>
                  Password is already set by the candidate during registration. Once approved, they can sign in directly with their email and password, then enroll their face biometric.
                </span>
              </div>

              {approvalError && (
                <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium">
                  {approvalError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-line/50">
              <button
                type="button"
                disabled={isApproving}
                onClick={() => setActiveSignup(null)}
                className="px-4 py-2.5 rounded-xl border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isApproving}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 disabled:opacity-60 cursor-pointer flex items-center gap-2"
              >
                {isApproving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Adding to Workforce…</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="size-4" />
                    <span>Approve &amp; Add as Employee</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
