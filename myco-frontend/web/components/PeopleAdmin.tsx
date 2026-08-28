'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Copy, KeyRound, UserPlus, X } from 'lucide-react';

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
        <code className="flex-1 select-all rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm tracking-wide text-ink">
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
  { value: 'hr_admin', label: 'HR Admin' },
  { value: 'super_admin', label: 'Super Admin' },
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
                  <Field name="email" label="Email (their sign-in)" required type="email" placeholder="asha@boxcode.ai" className="sm:col-span-2" />
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

/* --------------------------------------------------------- reset password */

export function ResetPasswordButton({ code, name }: { code: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function reset() {
    setConfirming(false);
    setError(null);
    setBusy(true);
    const res = await fetch(
      proxy(`/api/v1/admin/employees/${encodeURIComponent(code)}/reset-password`),
      { method: 'POST' },
    ).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not reset - try again');
      return;
    }
    setCreated((await res.json()) as Created);
  }

  if (created) {
    return <TempPasswordReveal created={created} onDone={() => setCreated(null)} />;
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2 transition-all active:scale-95 disabled:opacity-50"
      >
        <KeyRound className="size-3.5 text-ink-3" aria-hidden />
        {busy ? 'Resetting…' : 'Reset password'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-st-absent">
          <span aria-hidden>○ </span>{error}
        </span>
      )}
      {/* The app's own dialog, not window.confirm - it states the consequence
          before the click, the same rule every deciding action here follows. */}
      <ConfirmDialog
        open={confirming}
        title={`Reset ${name}'s password?`}
        consequence="Their current password stops working immediately. You get a temporary one, shown once, to hand over in person - they replace it at their next sign-in."
        confirmLabel="Reset it"
        tone="danger"
        busy={busy}
        onConfirm={reset}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
