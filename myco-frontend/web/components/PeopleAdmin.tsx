'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, Send, Shield, UserPlus, X } from 'lucide-react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { proxy } from '@/lib/format';

/**
 * Hire and re-issue a password, against endpoints that now exist
 * (POST /admin/employees, POST /admin/employees/{code}/reset-password).
 *
 * The one rule both flows share: the temporary password is SHOWN ONCE, here,
 * and is not recoverable - the API hashes it and forgets. So the reveal is
 * not a toast that fades; it stays on screen with a copy button until the
 * admin dismisses it themselves, because "it flashed and I lost it" means
 * running the reset again and confusing the person mid-handover.
 */

type Created = {
  employee: { emp_code: string; full_name: string };
  temporary_password: string;
  note: string;
};

function TempPasswordReveal({
  created, onDone,
}: { created: Created; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.temporary_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked - the password is still on screen to type over */
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-st-late/40 bg-st-late/5 p-4">
      <p className="text-sm font-semibold text-ink">
        Temporary password for {created.employee.full_name} ({created.employee.emp_code})
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all rounded-xl border-2 border-line bg-surface-2 px-3 py-2 font-mono text-sm tracking-wide font-bold text-ink">
          {created.temporary_password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-ink-2">
        Shown once and not recoverable - hand it over in person. They will be
        asked to replace it the first time they sign in.
      </p>
      <button
        type="button"
        onClick={onDone}
        className="text-xs font-semibold text-accent hover:underline"
      >
        Done - I have handed it over
      </button>
    </div>
  );
}

/* ----------------------------------------------------------- add employee */

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr_admin', label: 'Admin' },
];

export function AddEmployeeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const val = (k: string) => (f.get(k) as string).trim() || null;
    const res = await fetch(proxy('/api/v1/admin/employees'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emp_code: (f.get('emp_code') as string).trim().toUpperCase(),
        full_name: (f.get('full_name') as string).trim(),
        email: (f.get('email') as string).trim(),
        phone: val('phone'),
        department: val('department'),
        designation: val('designation'),
        manager_code: val('manager_code')?.toUpperCase() ?? null,
        date_of_joining: val('date_of_joining'),
        role: f.get('role') as string,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not create - is the API running?');
      return;
    }
    setCreated((await res.json()) as Created);
    router.refresh(); // the new row appears behind the reveal
  }

  function close() {
    setOpen(false);
    setError(null);
    setCreated(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-xs font-black uppercase tracking-wider text-ground shadow-xs hover:opacity-90 transition-transform active:scale-95 cursor-pointer"
      >
        <UserPlus className="size-4" aria-hidden />
        Add employee
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Add employee"
        >
          <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">
                {created ? 'Employee created' : 'Add employee'}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {created ? (
              <div className="mt-4">
                <TempPasswordReveal created={created} onDone={close} />
              </div>
            ) : (
              <form onSubmit={submit} className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field name="emp_code" label="Employee code" required placeholder="BX012" />
                  <Field name="full_name" label="Full name" required placeholder="Asha Patel" />
                  <Field name="email" label="Email (their sign-in)" required type="email" placeholder="asha@holbox.ai" className="sm:col-span-2" />
                  <Field name="phone" label="Phone" placeholder="+91 …" />
                  <Field name="department" label="Department" placeholder="Engineering" />
                  <Field name="designation" label="Designation" placeholder="Developer" />
                  <Field name="manager_code" label="Manager's code" placeholder="BX004" />
                  <Field name="date_of_joining" label="Date of joining" type="date" />
                  <label className="block text-xs font-mono text-ink-3">
                    Role
                    <select
                      name="role"
                      defaultValue="employee"
                      className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {error && (
                  <p role="alert" className="text-sm text-st-absent">
                    <span aria-hidden>○ </span>{error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-xl border border-line px-4 py-2.5 text-xs font-semibold text-ink hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-xl bg-ink px-4 py-2.5 text-xs font-black uppercase tracking-wider text-ground hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? 'Creating…' : 'Create & get password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  name, label, required, type = 'text', placeholder, className = '',
}: {
  name: string; label: string; required?: boolean;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <label className={`block text-xs font-mono text-ink-3 ${className}`}>
      {label}{required && <span aria-hidden> *</span>}
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </label>
  );
}

/* ----------------------------------------------------------- send message */

/**
 * A typed, human message into one employee's inbox - the follow-up to a
 * "needs attention" flag that a status code can't carry ("you forgot to
 * punch out, come see me"). Rides POST /notifications/send, so the row is
 * permanent and will ring their phone the day push is wired.
 */
export function SendMessageButton({ code, name }: { code: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setError(null);
    setBusy(true);
    const res = await fetch(proxy('/api/v1/notifications/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_code: code, message: message.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(typeof body?.detail === 'string' ? body.detail : 'Could not send - try again');
      return;
    }
    setSent(true);
    setMessage('');
    setTimeout(() => {
      setSent(false);
      setOpen(false);
    }, 1800);
  }

  return (
    <div className={open ? 'flex-1 basis-full sm:basis-auto sm:min-w-[320px]' : ''}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95"
      >
        <Send className="size-3.5 text-ink-3" aria-hidden />
        Send message
      </button>

      {open && (
        <form onSubmit={send} className="mt-3 space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={`A note for ${name} - lands in their app inbox…`}
            className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !message.trim()}
              className="rounded-xl bg-ink px-4 py-2 text-xs font-black uppercase tracking-wider text-ground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send to their inbox'}
            </button>
            {sent && (
              <span className="text-xs font-semibold text-st-present">
                <span aria-hidden>● </span>Delivered - it is in their notifications now
              </span>
            )}
            {error && (
              <span role="alert" className="text-xs text-st-absent">
                <span aria-hidden>○ </span>{error}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- role management */

export function ChangeRoleButton({
  code,
  name,
  currentRole,
  isSelf = false,
}: {
  code: string;
  name: string;
  currentRole: string | null;
  isSelf?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedRole, setSelectedRole] = useState(currentRole || 'employee');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const roles = [
    {
      id: 'hr_admin',
      title: 'Administrator',
      badge: 'Admin',
      badgeColor: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
      description: 'Full access to organization settings, team management, leaves, device enrolments, and employee roles.',
    },
    {
      id: 'manager',
      title: 'Team Manager',
      badge: 'Manager',
      badgeColor: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
      description: 'Can view team attendance board, approve leave requests for direct reports, and monitor shifts.',
    },
    {
      id: 'employee',
      title: 'Standard Employee',
      badge: 'Employee',
      badgeColor: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
      description: 'Basic access to mark attendance, apply for leave, submit attendance corrections, and view personal history.',
    },
  ];

  function openModal() {
    setSelectedRole(currentRole || 'employee');
    setError(null);
    setSuccess(null);
    dialogRef.current?.showModal();
  }

  function closeModal() {
    if (busy) return;
    dialogRef.current?.close();
  }

  async function handleSave() {
    if (isSelf) {
      setError('You cannot modify your own role.');
      return;
    }
    setError(null);
    setBusy(true);

    try {
      const res = await fetch(proxy(`/api/v1/admin/employees/${encodeURIComponent(code)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Failed to update employee role');
      }

      setSuccess(`Role updated to ${selectedRole === 'hr_admin' ? 'Admin' : selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}`);
      setTimeout(() => {
        closeModal();
        setSuccess(null);
        router.refresh();
      }, 900);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const roleText = currentRole === 'hr_admin' ? 'Admin' : currentRole === 'manager' ? 'Manager' : currentRole ? 'Employee' : 'No Account';

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={isSelf}
        title={isSelf ? 'You cannot change your own role' : `Change role for ${name}`}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
      >
        <Shield className="size-3.5 text-accent" aria-hidden />
        <span>Manage Role ({roleText})</span>
      </button>

      <dialog
        ref={dialogRef}
        onCancel={closeModal}
        className="bx-pop m-auto w-full max-w-lg rounded-2xl border border-line glass-panel p-0 text-ink shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-md overflow-hidden bg-surface"
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                <Shield className="size-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-ink text-base">Change Role</h3>
                <p className="text-xs text-ink-3">
                  {name} ({code})
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={closeModal}
              className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors cursor-pointer"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <p className="text-xs text-ink-2 leading-relaxed">
            Select the system access level for this employee. Upgrading an employee without a login will automatically activate their portal access.
          </p>

          {/* Role selection options */}
          <div className="space-y-2.5">
            {roles.map((r) => {
              const active = selectedRole === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => !busy && setSelectedRole(r.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition-all text-left flex items-start gap-3.5 ${
                    active
                      ? 'border-accent bg-accent/10 dark:bg-accent/20 ring-1 ring-accent'
                      : 'border-line bg-surface-2/40 hover:border-line-2 hover:bg-surface-2/80'
                  }`}
                >
                  <div className="pt-0.5 shrink-0">
                    <div
                      className={`size-4 rounded-full border flex items-center justify-center transition-all ${
                        active ? 'border-accent bg-accent' : 'border-line-2 bg-surface'
                      }`}
                    >
                      {active && <span className="size-1.5 rounded-full bg-white" />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-ink">{r.title}</span>
                      <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${r.badgeColor}`}>
                        {r.badge}
                      </span>
                    </div>
                    <p className="text-xs text-ink-2 mt-1 leading-normal">
                      {r.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
              <Check className="size-4" />
              <span>{success}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line/60">
            <button
              type="button"
              disabled={busy}
              onClick={closeModal}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50 cursor-pointer border border-line"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || selectedRole === currentRole}
              onClick={handleSave}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-xs font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 cursor-pointer shadow-md shadow-accent/25"
            >
              {busy && <RefreshCw className="size-3.5 animate-spin" />}
              <span>{selectedRole === 'hr_admin' ? 'Make Admin' : 'Save Role'}</span>
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/* --------------------------------------------------------- reset password */

export function ResetPasswordButton({ code, name }: { code: string; name: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'custom' | 'auto'>('custom');
  const [customPassword, setCustomPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  function openModal() {
    setError(null);
    setCustomPassword('');
    setMode('custom');
    dialogRef.current?.showModal();
  }

  function closeModal() {
    if (busy) return;
    dialogRef.current?.close();
  }

  async function handleReset(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (mode === 'custom' && customPassword.trim().length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setError(null);
    setBusy(true);

    const payload = mode === 'custom' && customPassword.trim() ? { password: customPassword.trim() } : {};

    const res = await fetch(
      proxy(`/api/v1/admin/employees/${encodeURIComponent(code)}/reset-password`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    ).catch(() => null);

    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not reset password - try again');
      return;
    }

    const data = (await res.json()) as Created;
    setCreated(data);
    closeModal();
  }

  if (created) {
    return <TempPasswordReveal created={created} onDone={() => setCreated(null)} />;
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={openModal}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
      >
        <KeyRound className="size-3.5 text-ink-3" aria-hidden />
        <span>Reset Password</span>
      </button>

      <dialog
        ref={dialogRef}
        onCancel={closeModal}
        className="bx-pop m-auto w-full max-w-md rounded-2xl border border-line glass-panel p-0 text-ink shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-md overflow-hidden bg-surface"
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-ink text-base">Reset Password</h3>
                <p className="text-xs text-ink-3">
                  {name} ({code})
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={closeModal}
              className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors cursor-pointer"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <p className="text-xs text-ink-2 leading-relaxed">
            Resetting will immediately replace the employee&rsquo;s current login credentials. You can set a specific password now or let the system generate one.
          </p>

          {/* Mode selection tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-surface-2 border border-line text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('custom');
                setError(null);
              }}
              className={`py-2 rounded-lg transition-all cursor-pointer ${
                mode === 'custom'
                  ? 'bg-surface text-ink shadow-sm border border-line'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Set Specific Password
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('auto');
                setError(null);
              }}
              className={`py-2 rounded-lg transition-all cursor-pointer ${
                mode === 'auto'
                  ? 'bg-surface text-ink shadow-sm border border-line'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              Auto-Generate
            </button>
          </div>

          <form onSubmit={handleReset} className="space-y-4">
            {mode === 'custom' ? (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-ink">
                  New Password
                </label>
                <input
                  type="text"
                  required
                  minLength={6}
                  placeholder="e.g. Himesh@2026 or secret pass"
                  value={customPassword}
                  onChange={(e) => setCustomPassword(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent font-mono"
                />
                <p className="text-[11px] text-ink-3">
                  Must be at least 6 characters. You can share this password directly with the employee.
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl border border-line bg-surface-2/70 text-xs text-ink-2 space-y-1">
                <p className="font-bold text-ink">System Generated Password</p>
                <p className="text-[11px] text-ink-3 leading-relaxed">
                  A secure, readable 3-word passphrase will be generated (e.g., <code>kestrel-harbour-quartz-48</code>) and shown once for you to copy.
                </p>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line/60">
              <button
                type="button"
                disabled={busy}
                onClick={closeModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50 cursor-pointer border border-line"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-md shadow-rose-600/25"
              >
                {busy && <RefreshCw className="size-3.5 animate-spin" />}
                <span>{mode === 'custom' ? 'Set Password' : 'Generate & Reset'}</span>
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}

export function EditCorrectionLimitButton({
  code,
  currentLimit,
}: {
  code: string;
  currentLimit: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(currentLimit);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const res = await fetch(proxy(`/api/v1/admin/employees/${code}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correction_limit: limit }),
    }).catch(() => null);

    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(typeof body?.detail === 'string' ? body.detail : 'Could not update limit');
      return;
    }

    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95"
      >
        Edit Correction Limit
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface/30 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <h2 className="font-display text-lg font-bold text-ink mb-4">Edit Correction Limit</h2>
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-sm font-mono text-ink-3">
                Limit (1-15)
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="mt-1 block w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </label>
              
              {error && (
                <p className="text-sm text-st-absent">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-ink px-4 py-2 text-xs font-black uppercase tracking-wider text-ground hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
