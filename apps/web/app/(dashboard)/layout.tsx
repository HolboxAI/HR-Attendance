import Link from 'next/link';

import { SignOut } from '@/components/SignOut';
import { currentIdentity } from '@/lib/session';

/**
 * The signed-in shell: header, role-aware nav, centred column.
 *
 * This used to live in the root layout, which meant every route got it -
 * including the login screen, which needs the full viewport. It moved here so
 * the chrome follows the session rather than the app.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await currentIdentity();

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-6">
            <Link href="/" className="flex items-baseline gap-3">
              <span className="font-display text-lg font-extrabold tracking-tight">Boxcode</span>
              <span className="text-xs uppercase tracking-[0.16em] text-accent">Attendance</span>
            </Link>
            {/*
              Nav follows the role. Enrolment is HR and above, so a manager
              is not shown a link that would only 403 - but note the link is
              the courtesy, not the control: the API refuses regardless.
            */}
            {me && (
              <nav className="flex items-baseline gap-4 text-sm">
                <Link href="/" className="text-ink-2 hover:text-ink">Board</Link>
                <Link href="/leave" className="text-ink-2 hover:text-ink">Leave</Link>
                {me.is_admin && (
                  <Link href="/enrolment" className="text-ink-2 hover:text-ink">Enrolment</Link>
                )}
              </nav>
            )}
          </div>
          {me
            ? <SignOut email={me.email} role={me.role} />
            : <span className="text-xs text-ink-3">IIMA Ventures, Ahmedabad</span>}
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-6 py-8">{children}</main>
    </>
  );
}
