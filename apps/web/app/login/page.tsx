'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail ?? 'Sign in failed');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="font-display text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink-2">
        The same account you use to check in. What you can see depends on your role.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs uppercase tracking-widest text-ink-3">
            Email
          </label>
          <input
            id="email" name="email" type="email" required autoComplete="username"
            autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-2 text-ink"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs uppercase tracking-widest text-ink-3">
            Password
          </label>
          <input
            id="password" name="password" type="password" required
            autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-surface-2 px-3 py-2 text-ink"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-st-absent">
            <span aria-hidden>○ </span>{error}
          </p>
        )}

        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-accent px-3 py-2 font-semibold text-[#1A1206] disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-xs text-ink-3">
        No account? There is no self-service signup — HR creates it for you.
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to keep the route static-safe.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
