'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpRight,
  Bell, CalendarClock, CalendarRange, Camera, ChevronLeft, ClipboardList, History, LayoutGrid,
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
      { href: '/board', label: 'Board', icon: CalendarRange, show: all },
      { href: '/checkin', label: 'Check in', icon: Camera, show: all },
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

export function SidebarNav({
  caps,
  onNavigate,
  collapsed = false,
}: {
  caps: Capabilities;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);

  return (
    <nav
      onMouseLeave={() => setHoveredHref(null)}
      className={`flex-1 overflow-y-auto bx-scroll py-2 transition-all duration-300 ${collapsed ? 'px-1.5 space-y-2' : 'px-2.5 space-y-3.5'}`}
    >
      {SECTIONS.map((section) => {
        const visible = section.items.filter((item) => item.show(caps));
        if (visible.length === 0) return null;
        return (
          <div key={section.title} className="space-y-1">
            {!collapsed ? (
              <div className="px-2.5 text-[9px] font-bold uppercase tracking-wider text-ink-3/80 font-mono transition-opacity duration-200">
                {section.title}
              </div>
            ) : (
              <div className="h-px bg-line/60 mx-2 my-1.5" />
            )}
            <div className="space-y-0.5">
              {visible.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const isHovered = hoveredHref === item.href;
                const isDimmed = hoveredHref !== null && !isHovered;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={onNavigate}
                    onMouseEnter={() => setHoveredHref(item.href)}
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center rounded-xl text-xs font-medium transition-all duration-300 group relative ${collapsed
                        ? 'justify-center size-9 mx-auto p-0'
                        : 'gap-2.5 px-2.5 py-2'
                      } ${active
                        ? 'bg-surface-2 text-ink font-semibold shadow-xs border border-line'
                        : 'text-ink-3 hover:bg-surface-2/60 hover:text-ink border border-transparent'
                      } ${isDimmed ? 'opacity-40 scale-[0.98]' : 'opacity-100 scale-100'
                      }`}
                  >
                    <Icon
                      className={`size-4 shrink-0 transition-transform duration-300 ${active ? 'text-ink' : 'text-ink-3 group-hover:text-ink group-hover:scale-110'
                        }`}
                      aria-hidden
                    />
                    {!collapsed && (
                      <span className="truncate transition-transform duration-300 group-hover:translate-x-1.5 font-medium">
                        {item.label}
                      </span>
                    )}
                    {!collapsed && (
                      <ArrowUpRight
                        className={`ml-auto size-3.5 text-ink-3 transition-all duration-300 ${isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none'
                          }`}
                        aria-hidden
                      />
                    )}
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

import { MenuToggle } from '@/components/ui/menu-toggle';
import { HolboxMark } from '@/components/ui/boxcode-logo';

export function SidebarBrand({
  collapsed = false,
  open = true,
  onToggle,
}: {
  collapsed?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className={`py-3.5 border-b border-line flex items-center justify-between transition-all duration-300 ${collapsed ? 'px-2 justify-center' : 'px-4'}`}>
      <Link href="/" className="flex items-center gap-2.5 text-ink group">
        <div className="size-7 shrink-0 rounded-lg bg-surface-2 border border-line flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform p-1">
          <HolboxMark className="w-full h-full" />
        </div>
        {!collapsed && (
          <div className="flex flex-col overflow-hidden whitespace-nowrap transition-all duration-200">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-sm font-bold tracking-tight text-ink">Holbox</span>
              <span className="text-[8px] font-mono uppercase tracking-wider px-1 py-0.5 rounded bg-surface-2 text-ink-3 border border-line">
                HRMS
              </span>
            </div>
            <span className="text-[10px] text-ink-3 font-mono">
              Workforce Portal
            </span>
          </div>
        )}
      </Link>

      {onToggle && !collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-surface-2 text-ink-3 hover:text-ink transition-colors cursor-pointer"
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <MenuToggle
            open={open}
            onOpenChange={() => onToggle()}
            className="size-4 text-ink-3 hover:text-ink pointer-events-none"
          />
        </button>
      )}
    </div>
  );
}

export function SidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={`border-t border-line py-2.5 text-[10px] text-ink-3 flex items-center font-mono transition-all duration-300 ${collapsed ? 'px-2 justify-center' : 'px-4'
      }`}>
      {!collapsed && <span>IIMA Ventures</span>}
    </div>
  );
}
