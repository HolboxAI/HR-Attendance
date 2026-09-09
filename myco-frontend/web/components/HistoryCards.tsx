'use client';

import React from 'react';
import Link from 'next/link';
import { 
  CheckCircle2, XCircle, Clock, CalendarDays, Edit3, AlertTriangle, MonitorPlay
} from 'lucide-react';

export type HistoryOverviewData = {
  present: number;
  absent: number;
  leave: number;
  wfh: number;
  corrections: number;
  exceptions: number;
  late: number;
};

export function HistoryCards({ data }: { data: HistoryOverviewData }) {
  const cards = [
    { title: 'Present', value: data.present, icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', href: '/history/attendance?status=present' },
    { title: 'Absent', value: data.absent, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', href: '/history/attendance?status=absent' },
    { title: 'Leave', value: data.leave, icon: CalendarDays, color: 'text-orange-500', bg: 'bg-orange-500/10', href: '/history/attendance?status=on_leave' },
    { title: 'Late', value: data.late, icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', href: '/history/attendance?late=true' },
    { title: 'Corrections', value: data.corrections, icon: Edit3, color: 'text-blue-500', bg: 'bg-blue-500/10', href: '/history/attendance?regularized=true' },
    { title: 'Exceptions', value: data.exceptions, icon: AlertTriangle, color: 'text-purple-500', bg: 'bg-purple-500/10', href: '/history/attendance?exception=true' },
    { title: 'WFH', value: data.wfh, icon: MonitorPlay, color: 'text-cyan-500', bg: 'bg-cyan-500/10', href: '/history/attendance?status=wfh' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link 
            key={card.title} 
            href={card.href}
            className="flex items-center p-4 rounded-2xl border border-line bg-surface hover:bg-surface-2 transition-all duration-200 group"
          >
            <div className={`p-3 rounded-xl mr-4 ${card.bg}`}>
              <Icon className={`size-5 ${card.color}`} />
            </div>
            <div>
              <p className="text-xs font-mono text-ink-3 uppercase tracking-wider">{card.title}</p>
              <p className="text-2xl font-bold text-ink mt-0.5 group-hover:scale-105 transition-transform origin-left">{card.value}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
