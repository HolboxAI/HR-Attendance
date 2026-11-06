'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const IST = 'Asia/Kolkata';

function clockInput(iso: string | null): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

const STATUS_CHOICES = [
  { id: 'present', label: 'Present', activeBg: 'bg-emerald-600 text-white border-emerald-600' },
  { id: 'absent', label: 'Absent', activeBg: 'bg-rose-600 text-white border-rose-600' },
  { id: 'half_day', label: 'Half Day', activeBg: 'bg-amber-600 text-white border-amber-600' },
  { id: 'on_leave', label: 'On Leave', activeBg: 'bg-orange-600 text-white border-orange-600' },
  { id: 'wfh', label: 'WFH', activeBg: 'bg-cyan-600 text-white border-cyan-600' },
] as const;

const LEAVE_TYPES = [
  { code: 'CL', label: 'Casual Leave (CL)' },
  { code: 'PL', label: 'Paid Leave (PL)' },
  { code: 'SL', label: 'Sick Leave (SL)' },
  { code: 'UL', label: 'Unpaid Leave (UL)' },
];

export function EditAttendance({
  employeeCode,
  date,
  status,
  firstIn,
  lastOut,
  workedLabel,
}: {
  employeeCode: string;
  date: string;
  status: string;
  firstIn: string | null;
  lastOut: string | null;
  workedLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<string>(
    ['present', 'absent', 'half_day', 'on_leave', 'wfh'].includes(status) ? status : 'present'
  );
  const [leaveTypeCode, setLeaveTypeCode] = useState('CL');
  const [checkIn, setCheckIn] = useState(clockInput(firstIn));
  const [checkOut, setCheckOut] = useState(clockInput(lastOut));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setNextStatus(['present', 'absent', 'half_day', 'on_leave', 'wfh'].includes(status) ? status : 'present');
    setLeaveTypeCode('CL');
    setCheckIn(clockInput(firstIn));
    setCheckOut(clockInput(lastOut));
    setReason('');
    setError(null);
    setOpen(true);
  }

  async function save() {
    const note = reason.trim();
    if (!note) {
      setError('A reason is mandatory for any attendance adjustment.');
      return;
    }
    setBusy(true);
    setError(null);

    const isLeave = nextStatus === 'on_leave' || nextStatus === 'half_day';
    const payload = {
      employee_code: employeeCode,
      shift_date: date,
      status: nextStatus,
      first_in: checkIn || null,
      last_out: checkOut || null,
      reason: note,
      leave_type_code: isLeave ? leaveTypeCode : null,
    };

    const res = await fetch('/api/gateway/api/v1/admin/history/attendance/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);

    setBusy(false);
    if (!res) {
      setError('Could not reach the server.');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(typeof body?.detail === 'string' ? body.detail : 'The edit was not saved.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className="rounded-lg border border-line px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-ink hover:bg-surface-2 transition-colors"
      >
        Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div
            role="dialog"
            aria-labelledby="edit-attendance-title"
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 text-left shadow-2xl transition-all"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 id="edit-attendance-title" className="font-display text-lg font-bold text-ink">
                  Edit Attendance Log
                </h2>
                <p className="mt-0.5 text-xs font-mono text-ink-3">
                  Employee: <span className="font-semibold text-ink">{employeeCode}</span> · Date: <span className="font-semibold text-ink">{date}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-ink-3 hover:text-ink text-sm font-mono p-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* 5 Status Options */}
            <div className="mt-4">
              <label className="block text-[11px] font-mono uppercase tracking-wider text-ink-3 mb-1.5 font-semibold">
                Status Selection (5 Options)
              </label>
              <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Status">
                {STATUS_CHOICES.map((choice) => {
                  const isSelected = nextStatus === choice.id;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => setNextStatus(choice.id)}
                      className={`rounded-xl border py-2.5 px-1 text-xs font-semibold text-center transition-all ${
                        isSelected
                          ? choice.activeBg + ' shadow-xs font-bold'
                          : 'border-line bg-surface-2/40 text-ink hover:bg-surface-2'
                      }`}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Leave Type Selector for On Leave & Half Day */}
            {(nextStatus === 'on_leave' || nextStatus === 'half_day') && (
              <div className="mt-4 rounded-xl border border-orange-500/20 bg-orange-500/5 p-3">
                <label className="block text-[11px] font-mono uppercase tracking-wider text-orange-600 dark:text-orange-400 font-semibold mb-1">
                  Leave Type for {nextStatus === 'on_leave' ? '1.0 Day Deduction' : '0.5 Day Deduction'}
                </label>
                <select
                  value={leaveTypeCode}
                  onChange={(e) => setLeaveTypeCode(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs font-mono text-ink"
                >
                  {LEAVE_TYPES.map((lt) => (
                    <option key={lt.code} value={lt.code}>
                      {lt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-ink-3">
                  {nextStatus === 'on_leave'
                    ? '• Deducts 1.0 day from the chosen leave balance and records approved leave.'
                    : '• Deducts 0.5 day from the chosen leave balance and records approved half-day leave.'}
                </p>
              </div>
            )}

            {/* Leave Balance Restoration Notice */}
            {(status === 'on_leave' || status === 'half_day') && (nextStatus === 'present' || nextStatus === 'absent' || nextStatus === 'wfh') && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
                ℹ️ Restoring to {nextStatus} will automatically restore the previously deducted leave balance for this date.
              </div>
            )}

            {/* Check-In / Check-Out Timings */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block text-[11px] font-mono uppercase tracking-wider text-ink-3">
                Check-in time
                <input
                  type="time"
                  value={checkIn}
                  onChange={(event) => setCheckIn(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink font-mono"
                />
              </label>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-ink-3">
                Check-out time
                <input
                  type="time"
                  value={checkOut}
                  onChange={(event) => setCheckOut(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink font-mono"
                />
              </label>
            </div>

            <p className="mt-2 text-[11px] font-mono text-ink-3">
              Worked hours remain {workedLabel} (derived from registered punches).
            </p>

            {/* Mandatory Reason */}
            <label className="mt-4 block text-[11px] font-mono uppercase tracking-wider text-ink font-bold">
              Reason for Adjustment <span className="text-rose-500 font-bold">* (Mandatory)</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                rows={3}
                className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-ink-4 focus:border-accent focus:outline-hidden"
                placeholder="Required: State clearly why this attendance record is being changed..."
              />
            </label>

            {error && (
              <p role="alert" className="mt-2 text-xs font-mono text-rose-500 font-semibold">{error}</p>
            )}

            {/* Actions */}
            <div className="mt-5 flex items-center justify-between border-t border-line/60 pt-4">
              <span className="text-[11px] font-mono text-ink-3">
                {!reason.trim() ? '⚠️ Reason required to save' : '✓ Reason entered'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-line px-3.5 py-2 text-xs font-mono text-ink hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || reason.trim().length === 0}
                  className="rounded-xl bg-ink px-4 py-2 text-xs font-mono font-bold text-ground disabled:opacity-40 transition-opacity"
                >
                  {busy ? 'Saving…' : 'Apply & Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
