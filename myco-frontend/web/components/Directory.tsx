'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, Trash2, X } from 'lucide-react';

import { Avatar } from '@/components/Avatar';
import { HoverProfile } from '@/components/HoverProfile';
import { HolboxSearch } from '@/components/HolboxSearch';
import { Status } from '@/components/Status';

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
}

export function Directory({
  rows,
  canDelete = false,
  currentEmployeeCode = null,
}: DirectoryProps) {
  const router = useRouter();
  const [localRows, setLocalRows] = useState<DirectoryRow[]>(rows);
  const [query, setQuery] = useState('');
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  // Deletion modal state
  const [deleteTarget, setDeleteTarget] = useState<DirectoryRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

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

  return (
    <div className="space-y-4 fade-in-up">
      {/* Success Notification Banner */}
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

      {/* Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl glass-panel p-6 text-ink shadow-2xl border border-line bg-surface/95 overflow-hidden space-y-5">
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
        </div>
      )}
    </div>
  );
}
