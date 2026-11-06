import Link from 'next/link';
import { Users } from 'lucide-react';

import { ErrorState } from '@/components/ErrorState';
import { ExEmployeesDirectory } from '@/components/ExEmployeesDirectory';
import { PageHeader } from '@/components/PageHeader';
import { getExEmployeesAdmin } from '@/lib/api';
import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ExEmployeesPage() {
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);

  if (!caps.canViewBoard) {
    return (
      <ErrorState
        reason="forbidden"
        forbiddenText="The Ex-Employees directory is for managers and HR."
      />
    );
  }

  const res = await getExEmployeesAdmin();
  const employees = res.ok ? res.data : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Ex Employees"
          sub="Directory of former employees who have left the company. All their attendance history, punch logs, leave records, and profiles are preserved and accessible."
        />
        <Link
          href="/people"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-line bg-surface text-xs font-semibold text-ink hover:bg-surface-2 active:scale-95 transition-all shadow-xs"
        >
          <Users className="size-3.5 text-ink-3" />
          <span>Active Directory</span>
        </Link>
      </div>

      <ExEmployeesDirectory
        initialEmployees={employees}
        canManagePeople={caps.canManagePeople}
      />
    </div>
  );
}
