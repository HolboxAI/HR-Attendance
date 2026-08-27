import { DeviceList } from '@/components/DeviceList';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { getDevices } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * "Whose phone is bound" is a real support question: the punch endpoint
 * refuses any handset that isn't the registered one. This page answers it,
 * and offers the one device action the backend actually has - unbind.
 */
export default async function DevicesPage() {
  const result = await getDevices();

  if (!result.ok) {
    return (
      <ErrorState
        reason={result.reason}
        forbiddenText="Device bindings are managed by HR administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices"
        sub="One handset per person - the punch endpoint checks the binding on every punch, so a stolen password alone cannot mark attendance. Unbinding is the escape hatch for a lost or replaced phone."
      />
      <DeviceList rows={result.data} />
    </div>
  );
}
