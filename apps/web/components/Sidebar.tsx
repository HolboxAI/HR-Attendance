'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarClock, CalendarRange, ClipboardList, LayoutGrid, ScanFace,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; adminOnly?: boolean };
type Section = { title: string; items: NavItem[] };

/**
 * Grouped the way a fuller product nav is grouped, but only with sections
 * Boxcode actually has. A reference dashboard's CRM/Finance/Sales/Task
 * sections are not here on purpose - those are explicit PRD non-goals for
 * this product (see docs/PRD.md), and a nav link to a module that does not
 * exist is a worse empty state than a short sidebar.
 */
const SECTIONS: Section[] = [
  {
    title: 'Overview',
    items: [{ href: '/', label: 'Dashboard', icon: LayoutGrid }],
  },
  {
    title: 'Attendance',
    items: [
      { href: '/board', label: 'Board', icon: CalendarRange },
      { href: '/corrections', label: 'Corrections', icon: ClipboardList, adminOnly: true },
    ],
  },
  {
    title: 'Leave',
    items: [{ href: '/leave', label: 'Leave', icon: CalendarClock }],
  },
  {
    title: 'People',
    items: [{ href: '/enrolment', label: 'Enrolment', icon: ScanFace, adminOnly: true }],
  },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <span className="font-display text-lg font-extrabold tracking-tight">Boxcode</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
            Attendance
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {SECTIONS.map((section) => {
          const visible = section.items.filter((item) => !item.adminOnly || isAdmin);
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                {section.title}
              </div>
              <div className="space-y-1">
                {visible.map((item) => {
                  // Exact match for "/" so it isn't permanently "active"
                  // underneath every other route.
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
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

      <div className="border-t border-line px-5 py-4 text-xs text-ink-3">
        IIMA Ventures, Ahmedabad
      </div>
    </aside>
  );
}
