'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, LogOut, Menu, Settings, X } from 'lucide-react';

import { HolboxSearch } from '@/components/HolboxSearch';
import { MenuToggle } from '@/components/ui/menu-toggle';
import { NotificationBell } from '@/components/NotificationBell';
import { SidebarBrand, SidebarFooter, SidebarNav } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { SpotlightCursor } from '@/components/ui/spotlight-cursor';
import { ParticleWave } from '@/components/ui/particle-wave';
import { OnboardingGuide } from '@/components/OnboardingGuide';
import type { Capabilities } from '@/lib/capabilities';
import { roleLabel } from '@/lib/capabilities';

function initialsFor(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    if (parts.length === 1 && parts[0].length > 0) return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * The signed-in frame: fixed glass sidebar on desktop, drawer on mobile,
 * and a high-fidelity auto-hiding glass topbar on scroll with independent content scrolling.
 */
export function Shell({
  email, role, name, avatarUrl, caps, employeeCode, faceEnrolled, children,
}: {
  email: string;
  role: string;
  name: string | null;
  avatarUrl?: string | null;
  caps: Capabilities;
  employeeCode?: string | null;
  faceEnrolled?: boolean;
  children: React.ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(false);
  const lastScrollY = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  const needsEnrolment = (!avatarUrl && !faceEnrolled) && !guideDismissed;

  useEffect(() => {
    setDrawer(false);
    setHeaderVisible(true);
    lastScrollY.current = 0;
  }, [pathname]);

  useEffect(() => {
    const saved = localStorage.getItem('bx-sidebar-open');
    if (saved !== null) {
      setSidebarOpen(saved === 'true');
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('bx-sidebar-open', String(next));
      return next;
    });
  };

  // One decision per frame, and the header is an OVERLAY (see below), so
  // hiding it cannot change the scroll container's height. The old version
  // collapsed the header in-flow: hiding grew <main> by ~90px, short pages
  // (Corrections, Team balances) suddenly fit, scrollTop snapped back, the
  // handler read that as "scrolling up", showed the header again - and the
  // navbar flickered in a loop it was generating itself.
  const scrollRaf = useRef(0);
  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const y = el.scrollTop;
      if (y < 15) setHeaderVisible(true);
      else if (y > lastScrollY.current + 8 && y > 35) setHeaderVisible(false);
      else if (y < lastScrollY.current - 8) setHeaderVisible(true);
      lastScrollY.current = y;
    });
  };

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  const initials = initialsFor(name, email);

  return (
    <div className="relative flex h-screen max-h-screen w-full bg-ground text-ink overflow-hidden">
      {/* Interactive Spotlight Cursor for all themes (auto-adapts to Dark & Light) */}
      <SpotlightCursor config={{ radius: 110 }} />

      {/* 3D Moving Particle Wave Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0 opacity-40">
        <ParticleWave className="w-full h-full" />
      </div>

      {/* Desktop Fixed Glass Sidebar Container */}
      <div
        className={`my-3.5 hidden h-[calc(100vh-28px)] lg:flex z-30 transition-all duration-300 ease-in-out shrink-0 relative ${
          sidebarOpen ? 'w-60 ml-3.5' : 'w-0 ml-0 overflow-hidden pointer-events-none p-0 my-0 border-0'
        }`}
      >
        <aside
          className={`h-full w-60 flex-col rounded-2xl glass-panel flex shadow-xl overflow-hidden backdrop-blur-2xl transition-all duration-300 ${
            sidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'
          }`}
        >
          <SidebarBrand open={sidebarOpen} onToggle={toggleSidebar} />
          <SidebarNav caps={caps} />
          <SidebarFooter />
        </aside>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setDrawer(false)}
          />
          <div className="bx-rise absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface shadow-2xl">
            <SidebarBrand open={true} onToggle={() => setDrawer(false)} />
            <SidebarNav caps={caps} onNavigate={() => setDrawer(false)} />
            <SidebarFooter />
          </div>
        </div>
      )}

      {/* Right side content column: auto-hiding topbar on scroll, independent scrolling main */}
      <div className="relative flex h-screen max-h-screen min-w-0 flex-1 flex-col overflow-hidden">
        {/* Auto-Hiding Glass Topbar */}
        <header
          className={`glass-panel absolute left-3.5 right-3.5 top-3.5 rounded-2xl flex items-center justify-between px-4 py-2.5 sm:px-6 z-20 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
            headerVisible
              ? 'translate-y-0 opacity-100'
              : '-translate-y-[130%] opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3">
            {/* Show open hamburger button in topbar ONLY when sidebar is collapsed on desktop */}
            {!sidebarOpen && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="hidden lg:flex size-9 rounded-xl glass-panel border border-line items-center justify-center text-ink hover:bg-surface-2 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Open sidebar"
                aria-label="Open sidebar"
              >
                <MenuToggle
                  open={false}
                  onOpenChange={() => {}}
                  className="size-4 text-ink pointer-events-none"
                />
              </button>
            )}

            {/* Mobile drawer hamburger button */}
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="lg:hidden size-9 rounded-xl glass-panel border border-line flex items-center justify-center text-ink hover:bg-surface-2 transition-all cursor-pointer shadow-xs active:scale-95"
              title="Open navigation"
              aria-label="Open navigation"
            >
              <MenuToggle
                open={drawer}
                onOpenChange={() => {}}
                className="size-4 text-ink pointer-events-none"
              />
            </button>

            <div className="flex items-center gap-2">
              <span className="font-display text-sm sm:text-base font-bold tracking-tight text-ink">
                {titleFor(pathname)}
              </span>
            </div>
          </div>

          {/* Quick Search - lives in the Shell, so it is the same working
              search on every dashboard page. Except the Directory, which
              has its own search box right below the header - offering the
              same field twice on one screen is clutter, not convenience. */}
          <div className={`${pathname === '/people' ? 'hidden' : 'hidden md:flex'} items-center relative max-w-sm w-full mx-4`}>
            <HolboxSearch
              // Remount per route: arriving somewhere clears whatever query
              // got you there, so the box is ready for the next search.
              key={pathname}
              variant="global"
              caps={caps}
              placeholders={[
                'Search people — try Himesh...',
                'Jump to a page — Devices, Board...',
                'Find someone by code — BX007...',
                'Open Team balances...',
                'Who is on leave? Try the Board...',
              ]}
            />
          </div>

          {/* User & Actions Hub */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <NotificationBell />

            <Link
              href="/settings"
              className="hidden sm:flex items-center gap-2.5 pl-2 border-l border-line/60 hover:opacity-80 transition-opacity group"
              title="Settings & Profile"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name ?? email}
                  className="size-8 rounded-full object-cover border border-line shadow-sm group-hover:border-ink/40 transition-colors"
                />
              ) : (
                <div className="size-8 rounded-full bg-surface-2 border border-line flex items-center justify-center text-ink font-bold font-mono text-xs shadow-sm group-hover:border-ink/40 transition-colors">
                  {initials}
                </div>
              )}
              <div className="flex flex-col text-left">
                <span className="max-w-36 truncate text-xs font-semibold text-ink" title={email}>
                  {name ?? email}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 font-medium">
                  {roleLabel(role)}
                </span>
              </div>
            </Link>

            <Link
              href="/settings"
              className="size-9 rounded-xl glass-panel border border-line flex items-center justify-center text-ink hover:bg-surface-2 hover:text-ink active:scale-95 cursor-pointer shadow-xs transition-all"
              title="Settings & Preferences"
              aria-label="Settings"
            >
              <Settings className="size-3.5 text-ink-3 hover:text-ink transition-colors" strokeWidth={2} aria-hidden />
            </Link>

            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="size-9 rounded-xl glass-panel border border-line flex items-center justify-center text-ink hover:bg-surface-2 hover:text-ink disabled:opacity-50 active:scale-95 cursor-pointer shadow-xs transition-all"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-3.5 text-ink-3 hover:text-ink transition-colors" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </header>

        {/* Scrollable Main Area (Tracks scroll to smoothly hide upper navbar) */}
        <main
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto bx-scroll px-4 pb-4 pt-[84px] sm:px-6 sm:pb-6 sm:pt-[88px] relative z-10 bg-transparent"
        >
          <div className="mx-auto max-w-[1360px] space-y-6 pb-12">{children}</div>
        </main>
      </div>

      {needsEnrolment && (
        <OnboardingGuide
          employeeName={name}
          employeeCode={employeeCode || null}
          onCompleted={() => {
            setGuideDismissed(true);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function titleFor(pathname: string): string {
  if (pathname === '/') return 'Dashboard Overview';
  if (pathname.startsWith('/board')) return 'Attendance Board';
  if (pathname.startsWith('/month')) return 'Attendance Month';
  if (pathname.startsWith('/corrections')) return 'Punch Corrections';
  if (pathname.startsWith('/leave/policy')) return 'Leave Policy & Holidays';
  if (pathname.startsWith('/leave/balances')) return 'Team Balances';
  if (pathname.startsWith('/leave/operations')) return 'Accrual & Year-End';
  if (pathname.startsWith('/leave/audit')) return 'Leave Audit Trail';
  if (pathname.startsWith('/leave')) return 'Leave Operations';
  if (pathname.startsWith('/people')) return 'People Directory';
  if (pathname.startsWith('/enrolment')) return 'Biometrics & Enrolment';
  if (pathname.startsWith('/devices')) return 'Device Handsets';
  if (pathname.startsWith('/settings')) return 'Settings & Preferences';
  if (pathname.startsWith('/notifications')) return 'Notifications Center';
  return 'Holbox HRMS';
}
