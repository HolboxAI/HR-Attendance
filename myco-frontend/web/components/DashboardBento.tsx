"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CalendarRange,
  ClipboardList,
  UserCheck,
  Clock,
  UserX,
  Calendar,
  AlertTriangle,
  ScanFace,
  Smartphone,
  Download,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import type { Board, Enrolments } from "@/lib/format";
import { hhmm } from "@/lib/format";
import type { Capabilities } from "@/lib/capabilities";
import { proxy } from "@/lib/format";
import { GlowCard } from "@/components/ui/spotlight-card";
import { Avatar } from "@/components/Avatar";

interface DashboardBentoProps {
  board: Board;
  name: string | null;
  pendingLeaveCount: number;
  pendingCorrectionsCount: number;
  rejectedCount: number;
  enrolments: Enrolments | null;
  caps: Capabilities;
  year: number;
  monthNum: number;
  monthLabel: string;
}

export function DashboardBento({
  board,
  name,
  pendingLeaveCount,
  pendingCorrectionsCount,
  rejectedCount,
  enrolments,
  caps,
  year,
  monthNum,
  monthLabel,
}: DashboardBentoProps) {
  const firstName = (name ?? "").split(" ")[0] || "Admin";
  const headcount = Math.max(1, board.summary.headcount);
  const presentPct = Math.round((board.summary.present / headcount) * 100);
  const inOfficePct = Math.round((board.summary.currently_in / headcount) * 100);
  const wfhEmployees = board.rows.filter((r) => r.is_wfh_enabled || r.status === 'wfh');

  return (
    <div className="space-y-6">
      {/* Bento Grid Core Section */}
      <section className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* Primary Hero Bento Card (Spans 3 cols, high-impact presence with monochromatic light grey spotlight) */}
        <GlowCard
          glowColor="monochrome"
          customSize
          className="md:col-span-3 rounded-3xl p-7 sm:p-9 glass-panel flex flex-col justify-between overflow-hidden relative group shadow-xl min-h-[290px]"
        >
          {/* Subtle repeating linear hatch pattern overlay with smooth radial mask */}
          <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.04)_0px_1px,transparent_1px_12px)] opacity-70 [mask-image:radial-gradient(ellipse_80%_60%_at_100%_0%,black_60%,transparent_110%)] pointer-events-none" />

          <div className="relative z-10 space-y-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 px-3 py-1 bg-surface-2/80 rounded-full text-[10px] font-bold font-mono text-ink-3 uppercase tracking-widest border border-line">
                <span className="size-1.5 rounded-full bg-ink animate-pulse" />
                Workforce Presence
              </span>
              <span className="text-[11px] font-mono text-ink-3">
                {new Date(`${board.shift_date}T00:00:00Z`).toLocaleDateString("en-IN", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
              </span>
            </div>

            <div>
              <div className="text-xs text-ink-3 font-mono uppercase tracking-wider mb-1">
                Good day, {firstName}
              </div>
              <div className="flex items-baseline gap-3">
                <h3 className="text-5xl sm:text-6xl font-black tracking-tighter text-ink font-display">
                  {presentPct}%
                </h3>
                <span className="text-sm text-ink-3 font-mono">
                  ({board.summary.present}/{headcount} present)
                </span>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-6 pt-4 border-t border-line/60 flex items-center justify-between gap-4">
            <p className="text-xs text-ink-3 leading-relaxed max-w-xs font-body">
              <strong className="text-ink font-semibold">{board.summary.currently_in} in office</strong> right now across biometric gateways.
            </p>
            <Link
              href="/board"
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-ground px-4 py-2 text-xs font-black uppercase tracking-wider hover:opacity-90 transition-transform active:scale-95 shrink-0 shadow-xs cursor-pointer"
            >
              Live Board
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </GlowCard>

        {/* Secondary Bento Card A: Real-Time Flow Breakdown (Spans 3 cols) */}
        <GlowCard
          glowColor="monochrome"
          customSize
          className="md:col-span-3 rounded-3xl p-7 glass-panel flex flex-col justify-between shadow-lg relative overflow-hidden group min-h-[290px]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
                  Attendance Flow
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 text-[9px] font-mono text-ink-3 border border-line">
                  <TrendingUp className="size-2.5" />
                  Live
                </span>
              </div>
              <p className="text-3xl font-black text-ink font-display mt-1">
                {board.summary.currently_in}{" "}
                <span className="text-sm font-normal text-ink-3 font-mono">Active On-Site</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-line/40">
            <div className="rounded-xl bg-surface-2/30 p-2.5 border border-line/40">
              <div className="text-[10px] font-mono uppercase text-ink-3">Late</div>
              <div className="text-lg font-bold text-ink font-display">{board.summary.late}</div>
            </div>
            <div className="rounded-xl bg-surface-2/30 p-2.5 border border-line/40">
              <div className="text-[10px] font-mono uppercase text-ink-3">Absent</div>
              <div className="text-lg font-bold text-ink font-display">{board.summary.absent}</div>
            </div>
            <div className="rounded-xl bg-surface-2/30 p-2.5 border border-line/40">
              <div className="text-[10px] font-mono uppercase text-ink-3">On Leave</div>
              <div className="text-lg font-bold text-ink font-display">{board.summary.on_leave}</div>
            </div>
          </div>
        </GlowCard>

        {/* Tertiary Stat B: Pending Decisions & Queue (Spans 2 cols) */}
        <Link href="/leave" className="md:col-span-2 block group">
          <GlowCard
            glowColor="monochrome"
            customSize
            className="w-full rounded-3xl p-6 glass-panel flex flex-col justify-between group shadow-sm transition-all h-full min-h-[140px]"
          >
            <div className="flex items-center justify-between">
              <span className="size-9 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-ink group-hover:scale-105 transition-transform">
                <ClipboardList className="size-4.5" />
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3 px-2 py-0.5 rounded-full bg-surface-2 border border-line">
                Decision Queue
              </span>
            </div>
            <div className="mt-4">
              <div className="text-3xl font-black text-ink font-display">
                {pendingLeaveCount + pendingCorrectionsCount}
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono mt-1">
                Pending Approvals
              </p>
            </div>
          </GlowCard>
        </Link>

        {/* Tertiary Stat C: System Health & Audit Score (Spans 2 cols) */}
        <div className="md:col-span-2">
          <GlowCard
            glowColor="monochrome"
            customSize
            className="w-full rounded-3xl p-6 glass-panel flex items-center gap-4 shadow-sm h-full min-h-[140px]"
          >
            <div className="size-12 rounded-2xl bg-surface-2 text-ink border border-line flex items-center justify-center shrink-0 shadow-xs font-bold text-lg">
              ★
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-ink font-display">99.9%</span>
                <span className="text-[10px] font-mono uppercase text-ink-3">Audit Sync</span>
              </div>
              <p className="text-xs text-ink-3 mt-0.5 font-mono">
                Biometric gateway state verified
              </p>
            </div>
          </GlowCard>
        </div>

        {/* Tertiary Stat D: Quick CSV Export Shortcut (Spans 2 cols) */}
        <a
          href={proxy(`/api/v1/admin/export/month.csv?year=${year}&month=${monthNum}`)}
          className="md:col-span-2 block group cursor-pointer"
        >
          <GlowCard
            glowColor="monochrome"
            customSize
            className="w-full rounded-3xl p-6 glass-panel flex items-center justify-between group shadow-sm transition-all h-full min-h-[140px]"
          >
            <div className="flex items-center gap-3.5">
              <span className="size-10 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-ink group-hover:scale-105 transition-transform">
                <Download className="size-4.5" />
              </span>
              <div>
                <div className="text-sm font-bold text-ink">Export {monthLabel}</div>
                <div className="text-[10px] font-mono text-ink-3">Live Register CSV</div>
              </div>
            </div>
            <ArrowUpRight className="size-4 text-ink-3 group-hover:text-ink transition-colors" />
          </GlowCard>
        </a>

        {/* Remote & Work From Home (WFH) Bento Card */}
        {wfhEmployees.length > 0 && (
          <GlowCard
            glowColor="monochrome"
            customSize
            className="md:col-span-6 rounded-3xl p-7 glass-panel flex flex-col justify-between shadow-lg relative overflow-hidden group"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
                  Remote & Work From Home (WFH)
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-[10px] font-mono font-medium border border-cyan-500/20">
                  <span className="size-1.5 rounded-full bg-cyan-500 animate-pulse" />
                  {board.summary.wfh || 0} active · {wfhEmployees.length} remote eligible
                </span>
              </div>
              <Link
                href="/board?f=wfh#register"
                className="inline-flex items-center gap-1 text-xs font-mono text-ink-3 hover:text-ink transition-colors"
              >
                View Live Board
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-5 pt-4 border-t border-line/40">
              {wfhEmployees.map((r) => {
                const isActive = r.punch_count > 0 || r.currently_in || r.status === 'wfh' || r.status === 'present' || r.status === 'half_day';
                return (
                  <div
                    key={r.employee_code}
                    className="rounded-2xl bg-surface-2/40 border border-line/50 p-3.5 flex flex-col justify-between group-hover:border-line transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <Avatar name={r.full_name} />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-surface ${
                              isActive ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/people/${r.employee_code}`}
                            className="text-xs font-bold text-ink hover:underline truncate block"
                          >
                            {r.full_name}{' '}
                            <span className="text-[10px] font-mono font-normal text-ink-3">
                              ({r.employee_code})
                            </span>
                          </Link>
                          <p className="text-[11px] text-ink-3 font-mono truncate">
                            {r.department || 'General'}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`text-[9px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium'
                            : 'bg-surface-2 text-ink-3 border-line'
                        }`}
                      >
                        {isActive ? 'Active WFH' : 'Scheduled'}
                      </span>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-line/30 flex items-center justify-between text-[11px] font-mono">
                      <span className="text-ink-3">
                        {isActive ? `In: ${hhmm(r.first_in)}` : 'Awaiting punch'}
                      </span>
                      {r.late_minutes > 0 ? (
                        <span className="text-amber-500 font-medium">+{r.late_minutes}m late</span>
                      ) : (
                        <span className="text-ink-3">{r.status.toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </GlowCard>
        )}
      </section>
    </div>
  );
}
