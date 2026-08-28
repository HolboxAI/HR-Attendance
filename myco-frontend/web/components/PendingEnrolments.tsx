'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, X } from 'lucide-react';

import { proxy } from '@/lib/format';

export type EnrolmentRequestRow = {
  id: string;
  employee_code: string;
  full_name: string;
  already_enrolled: boolean;
  submitted_at: string;
};

/**
 * Self-submitted reference photos waiting for a vouch. Approving is the one
 * human step self-service keeps: the admin is confirming the face belongs to
 * the person, which is what makes every later comparison mean something.
 */
export function PendingEnrolments({ rows }: { rows: EnrolmentRequestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setError(null);
    let note: string | null = null;
    if (!approve) {
      note = window.prompt(
        'Why is it rejected? The person sees this note in the app.',
        'Too blurry - retake in better light',
      );
      if (note === null) return; // cancelled
    }
    setBusy(id);
    const res = await fetch(proxy(`/api/v1/admin/enrolments/requests/${id}/decide`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve, note }),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not decide - try again');
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
        Awaiting your approval · {rows.length}
      </h2>
      <p className="max-w-prose text-sm text-ink-2">
        Submitted by the person from their own phone. Approving makes it their
        reference photo — you are vouching that the face is theirs.
      </p>
      {error && (
        <p role="alert" className="text-sm text-st-absent">
          <span aria-hidden>○ </span>{error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} className="glass-panel rounded-2xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={proxy(`/api/v1/admin/enrolments/requests/${r.id}/photo`)}
              alt={`Photo submitted by ${r.full_name}`}
              className="aspect-square w-full object-cover bg-surface-2"
            />
            <div className="space-y-3 p-4">
              <div>
                <p className="font-semibold text-ink text-sm">{r.full_name}</p>
                <p className="text-xs text-ink-3 font-mono">
                  {r.employee_code}
                  {r.already_enrolled && ' · replaces their current photo'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => decide(r.id, true)}
                  disabled={busy === r.id}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 px-3 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Check className="size-3.5" /> This is {r.full_name.split(' ')[0]}
                </button>
                <button
                  type="button"
                  onClick={() => decide(r.id, false)}
                  disabled={busy === r.id}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-line text-ink-2 hover:text-st-absent hover:border-st-absent/50 text-xs font-semibold py-2 px-3 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <X className="size-3.5" /> Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
