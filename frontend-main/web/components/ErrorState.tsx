import { Lock, ServerCrash, WifiOff } from 'lucide-react';

type Reason = 'unauthorised' | 'forbidden' | 'unreachable' | 'error';

/**
 * One vocabulary for a failed server-side fetch. A 403 is never "the server
 * is broken": apiFetch reports WHY a call failed, and this renders that
 * reason in words the person can act on. `forbiddenText` lets each page say
 * who the page is for, which beats a generic "access denied".
 */
export function ErrorState({
  reason, forbiddenText,
}: {
  reason: Reason; forbiddenText?: string;
}) {
  if (reason === 'forbidden') {
    return (
      <div className="bx-card flex flex-col items-center px-6 py-12 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <Lock className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-ink">
          {forbiddenText ?? 'This page is for HR administrators.'}
        </p>
        <p className="mt-1 text-xs text-ink-3">
          Your account is signed in correctly - this page just isn't part of your role.
        </p>
      </div>
    );
  }

  if (reason === 'unreachable') {
    return (
      <div className="bx-card flex flex-col items-center px-6 py-12 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <WifiOff className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-ink">The API isn&rsquo;t reachable</p>
        <p className="mt-2 text-xs text-ink-3">Start it and reload this page:</p>
        <pre className="mt-2 rounded bg-surface-2 px-3 py-2 text-left text-xs text-ink-2">
cd apps/api && .venv/bin/uvicorn app.main:app --reload</pre>
      </div>
    );
  }

  return (
    <div className="bx-card flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        <ServerCrash className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink">Something went wrong loading this page</p>
      <p className="mt-1 text-xs text-ink-3">The API answered with an error. Try reloading.</p>
    </div>
  );
}
