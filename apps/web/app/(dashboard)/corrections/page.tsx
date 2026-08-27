import { PendingCorrections } from '@/components/PendingCorrections';
import { getCorrectionsPending } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * The correction queue's first screen. The backend has carried this whole
 * workflow since PRD section 11 - submit, decide, recompute inside the
 * service call - with nothing in the dashboard to reach it until now.
 */
export default async function CorrectionsPage() {
  const pending = await getCorrectionsPending();

  if (!pending.ok) {
    return (
      <div className="bx-card p-6">
        <h2 className="text-lg font-semibold">This page is for HR</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          Correction requests are decided by HR, not by whoever submitted them -
          the same rule that keeps HR from approving their own leave.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Corrections</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          Approving adds the punch and recomputes the day immediately - the
          original event is never touched, so the evidence behind every
          decision stays intact.
        </p>
      </div>
      <PendingCorrections rows={pending.data} />
    </div>
  );
}
