import { getAllStatus, getMyRequests } from '@/lib/api';
import { LeaveStatusPageClient } from '@/components/LeaveStatusPageClient';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LeaveStatusPage() {
  const me = await currentIdentity();
  const isHr = me?.is_admin ?? false;
  let rows: any[] = [];

  if (isHr) {
    const res = await getAllStatus();
    if (res.ok) {
      rows = res.data;
    } else {
      const mine = await getMyRequests();
      rows = mine ?? [];
    }
  } else {
    const mine = await getMyRequests();
    rows = mine ?? [];
  }

  return <LeaveStatusPageClient rows={rows} isHr={isHr} />;
}
