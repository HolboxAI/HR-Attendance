import { redirect } from 'next/navigation';

import { Shell } from '@/components/Shell';
import { HoverProfileProvider, HoverCursorPreview } from '@/components/HoverProfile';
import { capabilitiesFor } from '@/lib/capabilities';
import { currentIdentity } from '@/lib/session';

/**
 * The signed-in shell. `bx-light` scopes the dashboard theme to this subtree
 * only - the sign-in page keeps its approved dark design.
 *
 * The stored dark/system preference is applied before first paint by the
 * beforeInteractive script in the ROOT layout, which flags <html> with
 * .bx-dark-mode; the CSS scopes that flag to #bx-shell so the sign-in page
 * is never affected.
 *
 * If the JWT is still in the cookie but the account is gone (offboarded or
 * hard-deleted), /auth/me is 401. Sending that browser to the enrolment
 * quest with name "Team Member" is wrong — they need login, and the dead
 * cookies have to be dropped or refresh keeps them here.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await currentIdentity();
  if (!me) {
    redirect('/api/session?clear=1');
  }
  const caps = capabilitiesFor(me.role);

  return (
    <HoverProfileProvider>
      <HoverCursorPreview />
      <div id="bx-shell" className="bx-light h-screen max-h-screen overflow-hidden">
        <Shell
          email={me.email}
          role={me.role}
          name={me.full_name ?? null}
          avatarUrl={me.avatar_url ?? null}
          employeeCode={me.employee_code ?? null}
          faceEnrolled={me.face_enrolled ?? false}
          caps={caps}
        >
          {children}
        </Shell>
      </div>
    </HoverProfileProvider>
  );
}
