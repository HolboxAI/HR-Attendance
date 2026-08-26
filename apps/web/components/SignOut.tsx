'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOut({ email, role }: { email: string; role: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function out() {
    setBusy(true);
    await fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="text-ink-3">
        {email}
        <span className="ml-2 uppercase tracking-[0.14em] text-accent">
          {role.replace('_', ' ')}
        </span>
      </span>
      <button
        type="button" onClick={out} disabled={busy}
        className="rounded border border-line px-2 py-1 text-ink-2 disabled:opacity-50"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
