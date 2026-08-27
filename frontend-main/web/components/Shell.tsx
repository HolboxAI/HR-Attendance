'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Menu, X } from 'lucide-react';

import { NotificationBell } from '@/components/NotificationBell';
import { SidebarBrand, SidebarFooter, SidebarNav } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { Capabilities } from '@/lib/capabilities';
import { roleLabel } from '@/lib/capabilities';

/**
 * The signed-in frame: fixed sidebar on desktop, a drawer below lg, and a
 * translucent topbar that floats over the scrolling page. Client component
 * because the drawer and the theme need state; the PAGES stay server
 * components and stream through as children.
 */
export function Shell({
  email, role, name, caps, children,
}: {
  email: string;
  role: string;
  name: string | null;
  caps: Capabilities;
  children: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // A route change closes the drawer - otherwise navigating on a phone leaves
  // the menu covering the page you just asked for.
  useEffect(() => setDrawer(false), [pathname]);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <SidebarBrand />
        <SidebarNav caps={caps} />
        <SidebarFooter />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
          />
          <div className="bx-rise absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-between pr-3">
              <SidebarBrand />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <SidebarNav caps={caps} onNavigate={() => setDrawer(false)} />
            <SidebarFooter />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bx-glass sticky top-0 z-20 flex items-center justify-between px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
              className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <Menu className="size-4" aria-hidden />
            </button>
            <span className="font-display text-sm font-semibold tracking-tight">
              {titleFor(pathname)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <ThemeToggle />
            <NotificationBell />
            <span className="hidden items-baseline gap-2 text-xs text-ink-3 md:flex">
              <span className="max-w-44 truncate" title={email}>{name ?? email}</span>
              <span className="uppercase tracking-[0.14em] text-accent">{roleLabel(role)}</span>
            </span>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <LogOut className="size-3" aria-hidden />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>

        <main className="bx-ambient flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function titleFor(pathname: string): string {
  if (pathname === '/') return 'Overview';
  if (pathname.startsWith('/board')) return 'Attendance board';
  if (pathname.startsWith('/month')) return 'Attendance month';
  if (pathname.startsWith('/corrections')) return 'Corrections';
  if (pathname.startsWith('/leave/policy')) return 'Leave policy';
  if (pathname.startsWith('/leave/balances')) return 'Team balances';
  if (pathname.startsWith('/leave/operations')) return 'Accrual & year-end';
  if (pathname.startsWith('/leave/audit')) return 'Leave audit';
  if (pathname.startsWith('/leave')) return 'Leave';
  if (pathname.startsWith('/people')) return 'People';
  if (pathname.startsWith('/enrolment')) return 'Face enrolment';
  if (pathname.startsWith('/devices')) return 'Devices';
  if (pathname.startsWith('/notifications')) return 'Notifications';
  return 'Boxcode';
}
