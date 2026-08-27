'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell, CalendarClock, CalendarRange, ClipboardList, History, LayoutGrid,
  ScanFace, Scale, Smartphone, SlidersHorizontal, Users,
} from 'lucide-react';

import type { Capabilities } from '@/lib/capabilities';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  show: (c: Capabilities) => boolean;
  /** Exact-match routes ("/" and parents of siblings) don't highlight for children. */
  exact?: boolean;
};
type Section = { title: string; items: NavItem[] };

const all = () => true;

/**
 * Grouped the way a fuller product nav is grouped, but only with sections
 * Boxcode actually has - a nav link to a module with no backend is a worse
 * empty state than a short sidebar (PRD §7). Visibility comes from the
 * capability model, not per-page role strings; the API stays the boundary.
 */
const SECTIONS: Section[] = [
  {
    title: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutGrid, show: all, exact: true },
      { href: '/notifications', label: 'Notifications', icon: Bell, show: all },
    ],
  },
  {
    title: 'Attendance',
    items: [
      { href: '/board', label: 'Board', icon: CalendarRange, show: (c) => c.canViewBoard },
      { href: '/corrections', label: 'Corrections', icon: ClipboardList, show: all },
    ],
  },
  {
    title: 'Leave',
    items: [
      { href: '/leave', label: 'Leave', icon: CalendarClock, show: all, exact: true },
      { href: '/leave/balances', label: 'Team balances', icon: Scale, show: (c) => c.canDecideLeave },
      { href: '/leave/policy', label: 'Policy & holidays', icon: SlidersHorizontal, show: (c) => c.canManageLeavePolicy },
      { href: '/leave/operations', label: 'Accrual & year-end', icon: History, show: (c) => c.canManageLeavePolicy },
      { href: '/leave/audit', label: 'Leave audit', icon: History, show: (c) => c.canManageLeavePolicy },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/people', label: 'Directory', icon: Users, show: (c) => c.canViewBoard },
      { href: '/enrolment', label: 'Enrolment', icon: ScanFace, show: (c) => c.canManageEnrolment },
      { href: '/devices', label: 'Devices', icon: Smartphone, show: (c) => c.canManageDevices },
    ],
  },
];

export function SidebarNav({ caps, onNavigate }: { caps: Capabilities; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto bx-scroll px-3 pb-4">
      {SECTIONS.map((section) => {
        const visible = section.items.filter((item) => item.show(caps));
        if (visible.length === 0) return null;
        return (
          <div key={section.title}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
              {section.title}
            </div>
            <div className="space-y-1">
              {visible.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-accent/10 font-medium text-accent'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-5 py-5">
      <Link href="/" className="flex items-center gap-2 text-ink">
        <span className="font-display text-lg font-extrabold tracking-tight">Boxcode</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          HRMS
        </span>
      </Link>
    </div>
  );
}

export function SidebarFooter() {
  return (
    <div className="border-t border-line px-5 py-4 text-xs text-ink-3">
      IIMA Ventures, Ahmedabad
    </div>
  );
}
