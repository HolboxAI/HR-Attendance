import { ErrorState } from '@/components/ErrorState';
import { LeaveOperations } from '@/components/LeaveOperations';
import { PageHeader } from '@/components/PageHeader';
import { getLeavePolicy } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function LeaveOperationsPage() {
  // The policy endpoint is hr_admin-gated: if this viewer can't read it, they
  // can't run these jobs either, and deserve the reason rather than a form
  // whose buttons all fail.
  const gate = await getLeavePolicy();
  if (!gate.ok) {
    return (
      <ErrorState
        reason={gate.reason}
        forbiddenText="Accrual and carry-forward are run by HR administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accrual & year-end"
        sub="The two leave jobs run by hand - monthly accrual, and the once-a-year carry-forward at the leave-year boundary. Both are idempotent: running either twice changes nothing."
      />
      <LeaveOperations />
    </div>
  );
}
