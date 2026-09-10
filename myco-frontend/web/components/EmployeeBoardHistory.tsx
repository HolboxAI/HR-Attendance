'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar, Clock, Filter, ChevronLeft, ChevronRight, CheckCircle2,
  AlertCircle, LogIn, LogOut, ShieldCheck, Timer, Sparkles, Smartphone,
  Laptop, CalendarDays, ArrowRight
} from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { hours, hhmm12, istToday, type MonthDay, type MonthResponse } from '@/lib/format';
import type { Identity } from '@/lib/session';

interface EmployeeBoardHistoryProps {
  data: MonthResponse | null;
  me: Identity | null;
  year: number;
  month: number;
}

export function EmployeeBoardHistory({
  data,
  me,
  year,
  month,
}: EmployeeBoardHistoryProps) {
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [searchDate, setSearchDate] = useState<string>('');
  const [todayData, setTodayData] = useState<any>(null);

  // Fetch today's live status from mobile/me endpoint
  useEffect(() => {
    fetch('/api/gateway/api/v1/mobile/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (d) setTodayData(d);
      })
      .catch(() => undefined);
  }, []);

  const todayStr = istToday();
  const allDays = data?.days ?? [];
  const todayDay = allDays.find((d) => d.date === todayStr);

  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Filter days
  const filteredDays = useMemo(() => {
    return allDays.filter((d) => {
      if (selectedFilter !== 'all') {
        if (selectedFilter === 'present' && d.status !== 'present') return false;
        if (selectedFilter === 'late' && d.status !== 'late') return false;
        if (selectedFilter === 'absent' && d.status !== 'absent') return false;
        if (selectedFilter === 'half_day' && d.status !== 'half_day') return false;
        if (selectedFilter === 'on_leave' && d.status !== 'on_leave') return false;
        if (selectedFilter === 'weekly_off' && d.status !== 'weekly_off') return false;
      }
      if (searchDate && !d.date.includes(searchDate)) {
        return false;
      }
      return true;
    });
  }, [allDays, selectedFilter, searchDate]);

  const workedTodayMin = todayData?.worked_minutes ?? todayDay?.worked_minutes ?? 0;
  const lateTodayMin = todayData?.late_minutes ?? todayDay?.late_minutes ?? 0;
  const isCurrentlyIn = todayData?.direction === 'out';

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <PageHeader
        title="Attendance History & Punch Board"
        sub="Track your daily punch records, biometric verification logs, and historical attendance."
      />

      {/* 1. TODAY'S ATTENDANCE & PUNCH BOARD */}
      <section className="glass-panel rounded-3xl border border-line p-6 sm:p-8 shadow-sm space-y-6 bg-gradient-to-b from-surface via-surface to-surface-2/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line/60 pb-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
              Today&apos;s Live Punch Status
            </div>
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2">
              <CalendarDays className="size-5 text-ink-2" />
              <span>
                {new Date().toLocaleDateString('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-bold flex items-center gap-2 border ${
              isCurrentlyIn
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : todayData?.checked_in_at
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                : 'bg-zinc-500/10 text-ink-3 border-line'
            }`}>
              <span className={`size-2 rounded-full ${isCurrentlyIn ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
              {isCurrentlyIn ? 'Active In Office' : todayData?.checked_in_at ? 'Punched Out' : 'Awaiting Check-in'}
            </div>

            <Link
              href="/"
              className="px-3.5 py-1.5 rounded-xl border border-line bg-surface-2 hover:bg-surface-2/80 text-xs font-semibold text-ink cursor-pointer transition-colors inline-flex items-center gap-1.5"
            >
              <span>Punch Camera</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        {/* Metric Cards for Today */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-surface-2/40 border border-line/60 space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 flex items-center gap-1.5">
              <LogIn className="size-3 text-emerald-500" /> First Check-In
            </span>
            <p className="font-display text-lg font-bold text-ink font-mono">
              {todayData?.checked_in_at ? hhmm12(todayData.checked_in_at) : '—'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-2/40 border border-line/60 space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 flex items-center gap-1.5">
              <LogOut className="size-3 text-rose-500" /> Last Check-Out
            </span>
            <p className="font-display text-lg font-bold text-ink font-mono">
              {todayData?.checked_out_at ? hhmm12(todayData.checked_out_at) : isCurrentlyIn ? 'In Session' : '—'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-2/40 border border-line/60 space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 flex items-center gap-1.5">
              <Clock className="size-3 text-blue-500" /> Hours Worked Today
            </span>
            <p className="font-display text-lg font-bold text-ink font-mono">
              {hours(workedTodayMin)}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-2/40 border border-line/60 space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 flex items-center gap-1.5">
              <Timer className="size-3 text-amber-500" /> Late by Today
            </span>
            <p className={`font-display text-lg font-bold font-mono ${
              lateTodayMin > 0 ? 'text-amber-500' : 'text-emerald-500'
            }`}>
              {lateTodayMin > 0 ? hours(lateTodayMin) : '0 hrs'}
            </p>
          </div>
        </div>

        {/* Today's Punch List */}
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-mono uppercase tracking-wider text-ink-3 font-semibold">
            Today&apos;s Chronological Punch Logs
          </h3>

          {todayData?.checked_in_at ? (
            <div className="space-y-2.5">
              {/* Check in punch entry */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 text-xs">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
                    <LogIn className="size-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink">Punch In (Check-in)</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        Face Verified
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-3 mt-0.5 font-mono">
                      Biometric match verified via Dashboard Camera
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-display text-sm font-bold text-ink font-mono">
                    {hhmm12(todayData.checked_in_at)}
                  </span>
                  <p className="text-[10px] text-ink-3 font-mono">Recorded</p>
                </div>
              </div>

              {/* Check out punch entry if available */}
              {todayData?.checked_out_at && (
                <div className="flex items-center justify-between p-3.5 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center font-bold">
                      <LogOut className="size-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink">Punch Out (Check-out)</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          Face Verified
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-3 mt-0.5 font-mono">
                        Biometric checkout verified
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-display text-sm font-bold text-ink font-mono">
                      {hhmm12(todayData.checked_out_at)}
                    </span>
                    <p className="text-[10px] text-ink-3 font-mono">Recorded</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 rounded-2xl border border-dashed border-line text-center space-y-2">
              <Clock className="size-6 text-ink-3 mx-auto" />
              <p className="text-xs text-ink-2 font-medium">No punches recorded for today yet.</p>
              <p className="text-[11px] text-ink-3">
                Use the Check-In button on the Dashboard to record your attendance.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 2. ATTENDANCE HISTORY LIST & MONTHLY ARCHIVE */}
      <section className="glass-panel rounded-3xl border border-line p-6 sm:p-8 shadow-sm space-y-6">
        {/* Month Navigation & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-line/60 pb-5">
          <div className="flex items-center gap-3">
            <Link
              href={`/board?on=${prevMonth.y}-${String(prevMonth.m).padStart(2, '0')}-01`}
              className="size-8 rounded-xl border border-line bg-surface-2 flex items-center justify-center text-ink hover:border-ink/40 transition-colors"
              title="Previous Month"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <h3 className="font-display text-lg font-bold text-ink">{monthName}</h3>
            <Link
              href={`/board?on=${nextMonth.y}-${String(nextMonth.m).padStart(2, '0')}-01`}
              className="size-8 rounded-xl border border-line bg-surface-2 flex items-center justify-center text-ink hover:border-ink/40 transition-colors"
              title="Next Month"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>

          {/* Status Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto bx-scroll">
            {[
              { id: 'all', label: 'All Days' },
              { id: 'present', label: 'Present' },
              { id: 'late', label: 'Late' },
              { id: 'half_day', label: 'Half Day' },
              { id: 'on_leave', label: 'On Leave' },
              { id: 'absent', label: 'Absent' },
              { id: 'weekly_off', label: 'Weekly Off' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                  selectedFilter === f.id
                    ? 'bg-ink text-surface font-semibold shadow-xs'
                    : 'bg-surface-2/60 text-ink-3 hover:text-ink hover:bg-surface-2'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Month Totals Summary */}
        {data?.totals && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-surface-2/30 border border-line/60">
              <span className="text-[10px] font-mono uppercase text-ink-3">Present Days</span>
              <p className="font-display text-xl font-bold text-emerald-500 font-mono mt-0.5">
                {data.totals.present} days
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-surface-2/30 border border-line/60">
              <span className="text-[10px] font-mono uppercase text-ink-3">Total Worked Hours</span>
              <p className="font-display text-xl font-bold text-ink font-mono mt-0.5">
                {hours(data.totals.worked_minutes)}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-surface-2/30 border border-line/60">
              <span className="text-[10px] font-mono uppercase text-ink-3">Late Arrivals</span>
              <p className="font-display text-xl font-bold text-amber-500 font-mono mt-0.5">
                {data.totals.late_minutes > 0 ? hours(data.totals.late_minutes) : '0 hrs'}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-surface-2/30 border border-line/60">
              <span className="text-[10px] font-mono uppercase text-ink-3">Overtime Logged</span>
              <p className="font-display text-xl font-bold text-blue-500 font-mono mt-0.5">
                {hours(data.totals.overtime_minutes)}
              </p>
            </div>
          </div>
        )}

        {/* Table / List of Days */}
        <div className="overflow-x-auto bx-scroll rounded-2xl border border-line">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2/50 text-[10px] font-mono uppercase tracking-wider text-ink-3">
                <th className="py-3 px-4 font-semibold">Date</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">First In</th>
                <th className="py-3 px-4 font-semibold">Last Out</th>
                <th className="py-3 px-4 font-semibold">Hours Worked</th>
                <th className="py-3 px-4 font-semibold">Late Minutes</th>
                <th className="py-3 px-4 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredDays.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-3 font-mono">
                    No attendance records found matching this filter.
                  </td>
                </tr>
              ) : (
                filteredDays.map((day) => {
                  const isToday = day.date === todayStr;
                  return (
                    <tr
                      key={day.date}
                      className={`hover:bg-surface-2/40 transition-colors ${
                        isToday ? 'bg-blue-500/5 font-medium' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{day.date}</span>
                          <span className="text-[10px] text-ink-3 uppercase">{day.weekday}</span>
                          {isToday && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                              Today
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={day.status} isWfh={day.is_wfh} />
                      </td>
                      <td className="py-3 px-4 font-mono text-ink">
                        {day.first_in ? hhmm12(day.first_in) : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-ink">
                        {day.last_out ? hhmm12(day.last_out) : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-ink">
                        {day.worked_minutes > 0 ? hours(day.worked_minutes) : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        {day.late_minutes > 0 ? (
                          <span className="text-amber-500 font-semibold">{hours(day.late_minutes)}</span>
                        ) : (
                          <span className="text-emerald-500 font-mono">0 hrs</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-ink-3 font-mono text-[11px] truncate max-w-xs">
                        {day.is_regularized ? (
                          <span className="text-blue-500 font-semibold">Regularized</span>
                        ) : day.exception_note ? (
                          day.exception_note
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status, isWfh }: { status: string; isWfh?: boolean }) {
  if (isWfh) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
        <Laptop className="size-3" /> WFH
      </span>
    );
  }
  switch (status) {
    case 'present':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <span className="size-1.5 rounded-full bg-emerald-500" /> Present
        </span>
      );
    case 'late':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <span className="size-1.5 rounded-full bg-amber-500" /> Late
        </span>
      );
    case 'half_day':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
          <span className="size-1.5 rounded-full bg-orange-500" /> Half Day
        </span>
      );
    case 'on_leave':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          <span className="size-1.5 rounded-full bg-blue-500" /> On Leave
        </span>
      );
    case 'absent':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
          <span className="size-1.5 rounded-full bg-rose-500" /> Absent
        </span>
      );
    case 'weekly_off':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium bg-surface-2 text-ink-3 border border-line">
          Weekly Off
        </span>
      );
    case 'holiday':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
          Holiday
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono text-ink-3">
          {status}
        </span>
      );
  }
}
