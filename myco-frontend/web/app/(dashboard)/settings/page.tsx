import { currentIdentity } from '@/lib/session';
import { SettingsPage } from '@/components/SettingsPage';

export const dynamic = 'force-dynamic';

export default async function Settings() {
  const me = await currentIdentity();
  return <SettingsPage user={me} />;
}
