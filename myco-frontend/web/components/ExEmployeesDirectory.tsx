'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  History,
  RotateCcw,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { EmployeeAdminRow } from '@/lib/api';

function formatLocalDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

function calculateTenure(joiningIso: string | null | undefined, exitIso: string | null | undefined): string {
  if (!joiningIso) return '—';
  try {
    const start = new Date(`${joiningIso}T00:00:00Z`);
    const end = exitIso ? new Date(`${exitIso}T00:00:00Z`) : new Date();
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return '—';
    const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const months = Math.floor(totalDays / 30.4375);
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;

    if (years > 0) {
      return remainingMonths > 0 ? `${years} yr ${remainingMonths} mo` : `${years} yr${years > 1 ? 's' : ''}`;
    }
    if (months > 0) {
      return `${months} month${months > 1 ? 's' : ''}`;
    }
    return `${totalDays} day${totalDays > 1 ? 's' : ''}`;
  } catch {
    return '—';
  }
}

interface ExEmployeesDirectoryProps {
  initialEmployees: EmployeeAdminRow[];
  canManagePeople?: boolean;
}

export function ExEmployeesDirectory({
  initialEmployees,
  canManagePeople = false,
}: ExEmployeesDirectoryProps) {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeAdminRow[]>(initialEmployees);
  const [query, setQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('all');

  // Reactivate modal state
  const [reactivateTarget, setReactivateTarget] = useState<EmployeeAdminRow | null>(null);
  const [isReactivating, setIsReactivating] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.department) set.add(e.department);
    });
    return Array.from(set).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((e) => {
      const matchesQuery =
        !q ||
        e.full_name.toLowerCase().includes(q) ||
        e.emp_code.toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q);

      const matchesDept = selectedDept === 'all' || e.department === selectedDept;

      return matchesQuery && matchesDept;
    });
  }, [employees, query, selectedDept]);

  async function handleConfirmReactivate() {
    if (!reactivateTarget) return;
    setIsReactivating(true);
    setReactivateError(null);

    try {
      const res = await fetch(`/api/gateway/api/v1/admin/employees/${encodeURIComponent(reactivateTarget.emp_code)}/reactivate`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setReactivateError(data.detail ?? data.reason ?? 'Failed to reactivate employee.');
        setIsReactivating(false);
        return;
      }

      // Remove from ex-employees local list
      setEmployees((prev) => prev.filter((e) => e.emp_code !== reactivateTarget.emp_code));
      setSuccessMessage(
        `${reactivateTarget.full_name} (${reactivateTarget.emp_code}) has been reactivated and restored to the active directory.`
      );
      setReactivateTarget(null);
      router.refresh();

      setTimeout(() => {
        setSuccessMessage(null);
      }, 7000);
    } catch (err: any) {
      setReactivateError(err.message ?? 'An unexpected network error occurred.');
    } finally {
      setIsReactivating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast Banner */}
      {successMessage && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/people"
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] transition-colors shrink-0 shadow-xs"
            >
              Go to Active Directory →
            </Link>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="p-1 rounded-lg hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Control Bar: Search & Department filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-3 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ex-employees by name, code, role..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-line bg-surface-2/60 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-3 hover:text-ink transition-colors"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 overflow-x-auto pb-1 sm:pb-0">
          {departments.length > 0 && (
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-3 py-2 rounded-xl border border-line bg-surface-2/60 text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
            >
              <option value="all">All Departments ({employees.length})</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line bg-surface-2/40 text-xs font-semibold text-ink-2 shrink-0">
            <UserX className="size-3.5 text-rose-500" />
            <span>{employees.length} Ex-Employee{employees.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* Directory Table / Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-line glass-panel p-12 text-center space-y-3">
          <div className="mx-auto size-12 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-ink-3">
            <UserX className="size-6" />
          </div>
          <h3 className="font-display text-base font-bold text-ink">
            {employees.length === 0 ? 'No Ex-Employees' : 'No matching ex-employees found'}
          </h3>
          <p className="mx-auto max-w-md text-xs text-ink-3 leading-relaxed">
            {employees.length === 0
              ? 'When employees leave the company and are moved out of the active directory, their complete records, punch logs, and leave history will be archived here.'
              : `No former team members match "${query}". Try clearing the search or filter.`}
          </p>
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedDept('all');
              }}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-xs font-semibold text-ink hover:bg-surface-2 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block rounded-2xl border border-line glass-panel overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
                  <th className="px-5 py-3.5 font-semibold">Former Employee</th>
                  <th className="px-5 py-3.5 font-semibold">Department &amp; Designation</th>
                  <th className="px-5 py-3.5 font-semibold">Date of Joining</th>
                  <th className="px-5 py-3.5 font-semibold">Date of Exit</th>
                  <th className="px-5 py-3.5 font-semibold">Tenure</th>
                  <th className="px-5 py-3.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {filtered.map((emp) => {
                  const tenure = calculateTenure(emp.date_of_joining, emp.date_of_exit);
                  return (
                    <tr
                      key={emp.emp_code}
                      className="group hover:bg-surface-2/50 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/people/${encodeURIComponent(emp.emp_code)}`}
                          className="flex items-center gap-3 group-hover:opacity-90"
                        >
                          <span className="size-9 rounded-full border border-line overflow-hidden shrink-0 [&>span]:size-9">
                            <Avatar name={emp.full_name} code={emp.emp_code} src={emp.avatar_url} />
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-ink flex items-center gap-2">
                              <span>{emp.full_name}</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                Ex
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-ink-3">
                              {emp.emp_code} {emp.email ? `· ${emp.email}` : ''}
                            </div>
                          </div>
                        </Link>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="text-ink font-medium">
                          {emp.designation || 'Team Member'}
                        </div>
                        <div className="text-[11px] text-ink-3">
                          {emp.department || 'Unassigned'}
                        </div>
                      </td>

                      <td className="px-5 py-3.5 font-mono text-ink-2">
                        {formatLocalDate(emp.date_of_joining)}
                      </td>

                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono text-[11px] font-semibold border border-rose-500/20">
                          <span className="size-1.5 rounded-full bg-rose-500" />
                          {formatLocalDate(emp.date_of_exit)}
                        </span>
                      </td>

                      <td className="px-5 py-3.5 font-mono text-ink-3 text-[11px]">
                        {tenure}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/people/${encodeURIComponent(emp.emp_code)}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line text-xs font-medium text-ink hover:bg-surface-2 transition-all cursor-pointer"
                            title="View past attendance history and reports"
                          >
                            <History className="size-3.5 text-ink-3" />
                            <span>View History</span>
                          </Link>

                          {canManagePeople && (
                            <button
                              type="button"
                              onClick={() => {
                                setReactivateError(null);
                                setReactivateTarget(emp);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer"
                              title={`Reactivate ${emp.full_name} back to active staff`}
                            >
                              <UserCheck className="size-3.5" />
                              <span>Reactivate</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {filtered.map((emp) => {
              const tenure = calculateTenure(emp.date_of_joining, emp.date_of_exit);
              return (
                <div
                  key={emp.emp_code}
                  className="rounded-2xl border border-line glass-panel p-4 space-y-3 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/people/${encodeURIComponent(emp.emp_code)}`}
                      className="flex items-center gap-3 min-w-0"
                    >
                      <span className="size-10 rounded-full border border-line overflow-hidden shrink-0 [&>span]:size-10">
                        <Avatar name={emp.full_name} code={emp.emp_code} src={emp.avatar_url} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-ink truncate">
                          {emp.full_name}
                        </div>
                        <div className="text-xs font-mono text-ink-3">
                          {emp.emp_code} · {emp.department || 'Unassigned'}
                        </div>
                      </div>
                    </Link>

                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20 shrink-0">
                      Ex-Employee
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-line/40">
                    <div>
                      <span className="text-[10px] uppercase font-mono text-ink-3 block">Exit Date</span>
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {formatLocalDate(emp.date_of_exit)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-mono text-ink-3 block">Tenure</span>
                      <span className="text-ink-2 font-mono">{tenure}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Link
                      href={`/people/${encodeURIComponent(emp.emp_code)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line text-xs font-medium text-ink hover:bg-surface-2 transition-all flex-1 justify-center"
                    >
                      <History className="size-3.5 text-ink-3" />
                      <span>View History</span>
                    </Link>

                    {canManagePeople && (
                      <button
                        type="button"
                        onClick={() => {
                          setReactivateError(null);
                          setReactivateTarget(emp);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all flex-1 justify-center"
                      >
                        <UserCheck className="size-3.5" />
                        <span>Reactivate</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Reactivate Confirmation Dialog */}
      {reactivateTarget && (
        <ConfirmDialog
          open={Boolean(reactivateTarget)}
          onClose={() => {
            if (!isReactivating) {
              setReactivateTarget(null);
              setReactivateError(null);
            }
          }}
          onConfirm={handleConfirmReactivate}
          title={`Reactivate ${reactivateTarget.full_name}?`}
          consequence={`This will restore ${reactivateTarget.full_name} (${reactivateTarget.emp_code}) to active employee status. They will be moved back to the active People Directory, will reappear on attendance registers, and will be able to log in and punch again.`}
          confirmLabel={isReactivating ? 'Reactivating…' : 'Yes, Reactivate Employee'}
          busy={isReactivating}
        >
          {reactivateError && (
            <div className="mt-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium">
              {reactivateError}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
