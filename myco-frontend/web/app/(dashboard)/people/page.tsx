import { Directory, type DirectoryRow } from '@/components/Directory';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { AddEmployeeButton } from '@/components/PeopleAdmin';
import { getBoard, getDevices, getEnrolments } from '@/lib/api';
import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Scoped automatically by the API: a manager's board only contains their
 * reports, so their directory only contains their reports. HR-only facts
 * (enrolment, device binding) merge in when those calls succeed and simply
 * stay absent when they don't.
 */
export default async function PeoplePage() {
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);
  const board = await getBoard();

  if (!board.ok) {
    return (
      <ErrorState
        reason={board.reason}
        forbiddenText="The directory is for managers and HR - it lists the people whose attendance you can see."
      />
    );
  }

  const [enrolments, devices] = await Promise.all([getEnrolments(), getDevices()]);
  const enrolledBy = new Map((enrolments?.rows ?? []).map((r) => [r.employee_code, r.enrolled]));
  const deviceBy = devices.ok
    ? new Map(devices.data.map((d) => [d.employee_code, d.bound]))
    : null;

  const rows: DirectoryRow[] = board.data.rows.map((r) => ({
    code: r.employee_code,
    name: r.full_name,
    department: r.department,
    shift: r.shift_label,
    status: r.status,
    currentlyIn: r.currently_in,
    enrolled: enrolments ? (enrolledBy.get(r.employee_code) ?? false) : null,
    deviceBound: deviceBy ? (deviceBy.get(r.employee_code) ?? false) : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="People"
          sub="Everyone you can see, with today's status. New hires are created here by HR - there is no self-service signup, deliberately."
        />
        {caps.canManagePeople && <AddEmployeeButton />}
      </div>
      <Directory
        rows={rows}
        canDelete={caps.canManagePeople}
        currentEmployeeCode={me?.employee_code}
      />
    </div>
  );
}
