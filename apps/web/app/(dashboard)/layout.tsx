import { NotificationBell } from '@/components/NotificationBell';
import { Sidebar } from '@/components/Sidebar';
import { SignOut } from '@/components/SignOut';
import { currentIdentity } from '@/lib/session';

/**
 * The signed-in shell: sidebar nav plus a topbar.
 *
 * `bx-light` scopes the light theme to this subtree only - see the comment in
 * globals.css. The sign-in page stays the dark design already shipped; only
 * what's behind a session goes light-with-shadows.
 *
 * `me` can only be null here in the gap between the proxy's auth check and a
 * revoked session - proxy.ts already redirects anyone without one before a
 * (dashboard) page is reached, so this renders the full chrome unconditionally
 * rather than branching on a case that shouldn't reach render.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await currentIdentity();

  return (
    <div className="bx-light flex min-h-screen">
      <Sidebar isAdmin={me?.is_admin ?? false} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
          <div>
            <span className="font-display text-sm font-semibold tracking-tight">Attendance</span>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            {me && <SignOut email={me.email} role={me.role} />}
          </div>
        </header>
        <main className="flex-1 px-6 py-8">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
