import { NotificationsPage } from '@/components/NotificationsPage';
import { PageHeader } from '@/components/PageHeader';
import { getNotifications } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Notifications() {
  const rows = (await getNotifications()) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        sub="Everything the product has told you, kept here permanently - the record exists whether or not a phone ever rings. Push delivery is not switched on yet."
      />
      <NotificationsPage initial={rows} />
    </div>
  );
}
