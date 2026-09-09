import { getAllStatus } from '@/lib/api';
import { LeaveStatusPageClient } from '@/components/LeaveStatusPageClient';
import { currentIdentity } from '@/lib/session';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LeaveStatusPage() {
  const me = await currentIdentity();
  const res = await getAllStatus();
  
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) redirect('/');
    return (
      <div className="p-8">
        <p className="rounded-2xl border border-line glass-panel p-6 text-sm text-ink-2">
          Could not load leave status. Try signing out and back in.
        </p>
      </div>
    );
  }

  return <LeaveStatusPageClient rows={res.data} isHr={me?.is_admin ?? false} />;
}
