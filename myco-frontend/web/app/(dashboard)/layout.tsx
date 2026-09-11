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
 * `me` can only be null in the gap between proxy.ts's auth check and a
 * revoked session, so the chrome renders unconditionally.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await currentIdentity();
  const caps = capabilitiesFor(me?.role);

  return (
    <HoverProfileProvider>
      <HoverCursorPreview />
      <div id="bx-shell" className="bx-light h-screen max-h-screen overflow-hidden">
        <Shell
          email={me?.email ?? ''}
          role={me?.role ?? 'employee'}
          name={me?.full_name ?? null}
          avatarUrl={me?.avatar_url ?? null}
          employeeCode={me?.employee_code ?? null}
          faceEnrolled={me?.face_enrolled ?? !!me?.avatar_url}
          caps={caps}
        >
          {children}
        </Shell>
      </div>
    </HoverProfileProvider>
  );
}
