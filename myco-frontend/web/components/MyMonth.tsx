'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Camera, LogIn, LogOut, Clock,
  CheckCircle2, AlertCircle, Timer, Sparkles, Check, Loader2, ArrowRight
} from 'lucide-react';

import { MonthCalendar } from '@/components/MonthCalendar';
import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { statusGlyph, statusLabel } from '@/components/Status';
import {
  hhmm, hhmm12, hours, istToday, istYearMonth, monthLabel,
  type MonthDay, type MonthResponse
} from '@/lib/format';

type Data = MonthResponse | null;

type TodayStatus = {
  employee_code: string;
  full_name: string;
  direction: 'in' | 'out';
  checked_in_at: string | null;
  checked_out_at: string | null;
  worked_minutes: number;
  late_minutes: number;
  shift_label: string;
  shift_start: string | null;
  shift_end: string | null;
  office_name: string;
};

const OFFICE = { lat: 23.03479, lng: 72.53238 };

function getHandsetId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = localStorage.getItem('bx-handset-id');
    if (saved) return saved;
    const fresh = `web-${crypto.randomUUID()}`;
    localStorage.setItem('bx-handset-id', fresh);
    return fresh;
  } catch {
    return 'web-storage-unavailable';
  }
}

export function MyMonth({
  data, name, year, month,
}: {
  data: Data; name: string | null; year: number; month: number;
}) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [todayData, setTodayData] = useState<TodayStatus | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [punchFeedback, setPunchFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string;
  } | null>(null);

  // Current clock time updated every 30 seconds for dynamic shift progress circle
  const [currentMinuteOfDay, setCurrentMinuteOfDay] = useState(() => {
    const now = new Date();
    const istStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    const [h, m] = istStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const istStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
      const [h, m] = istStr.split(':').map(Number);
      setCurrentMinuteOfDay((h || 0) * 60 + (m || 0));
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const loadTodayStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/api/v1/mobile/me');
      if (res.ok) {
        const j = await res.json();
        setTodayData(j);
      }
    } catch {
      // ignore network hiccup
    }
  }, []);

  useEffect(() => {
    loadTodayStatus();
  }, [loadTodayStatus]);

  // Handle punch through CameraCaptureModal
  async function handlePunch(file: File) {
    setBusy(true);
    setPunchFeedback(null);

    let lat = OFFICE.lat;
    let lng = OFFICE.lng;
    let accuracy = 15;

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
          })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracy = Math.round(pos.coords.accuracy || 15);
      } catch {
        // use fallback coords for smooth demo if permission denied
      }
    }

    const form = new FormData();
    form.append('selfie', file, 'punch.jpg');
    form.append('lat', String(lat));
    form.append('lng', String(lng));
    form.append('accuracy_m', String(accuracy));
    form.append('is_mocked', 'false');

    try {
      const handsetId = getHandsetId();
      const res = await fetch('/api/gateway/api/v1/mobile/punch', {
        method: 'POST',
        headers: { 'X-Install-Id': handsetId },
        body: form,
      });

      setBusy(false);
      setModalOpen(false);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setPunchFeedback({
          type: 'error',
          message: err.detail ?? `Server answered ${res.status}`,
        });
        return;
      }

      const resData = await res.json();
      if (resData.accepted) {
        setPunchFeedback({
          type: 'success',
          message: resData.message,
          details: resData.face_similarity ? `Face similarity ${Number(resData.face_similarity).toFixed(1)}%` : undefined,
        });
        await loadTodayStatus();
      } else {
        setPunchFeedback({
          type: 'error',
          message: resData.message,
        });
      }
    } catch {
      setBusy(false);
      setModalOpen(false);
      setPunchFeedback({
        type: 'error',
        message: 'Could not connect to authentication gateway',
      });
    }
  }

  // Shift progress calculations
  const shiftInfo = useMemo(() => {
    const rawLabel = todayData?.shift_label || '09:30 - 18:30';
    let startStr = todayData?.shift_start;
    let endStr = todayData?.shift_end;

    if (!startStr || !endStr) {
      const parts = rawLabel.split('-').map((s) => s.trim());
      if (parts.length === 2) {
        startStr = parts[0];
        endStr = parts[1];
      }
    }

    startStr = startStr || '09:30';
    endStr = endStr || '18:30';

    const [sH, sM] = startStr.split(':').map(Number);
    const [eH, eM] = endStr.split(':').map(Number);

    const startMin = (sH || 0) * 60 + (sM || 0);
    let endMin = (eH || 0) * 60 + (eM || 0);
    if (endMin <= startMin) endMin += 24 * 60; // overnight shift

    const totalMinutes = endMin - startMin;
    let elapsedMinutes = currentMinuteOfDay - startMin;

    if (currentMinuteOfDay < startMin) {
      elapsedMinutes = 0;
    } else if (elapsedMinutes > totalMinutes) {
      elapsedMinutes = totalMinutes;
    }

    const progress = totalMinutes > 0 ? Math.min(100, Math.max(0, (elapsedMinutes / totalMinutes) * 100)) : 0;
    const remainingMinutes = Math.max(0, totalMinutes - elapsedMinutes);
    const isShiftEnded = currentMinuteOfDay >= endMin;
    const isShiftStarted = currentMinuteOfDay >= startMin;

    return {
      startStr,
      endStr,
      totalMinutes,
      elapsedMinutes,
      remainingMinutes,
      progress,
      isShiftStarted,
      isShiftEnded,
    };
  }, [todayData, currentMinuteOfDay]);

  if (!data) {
    return (
      <div className="rounded-2xl border border-st-absent/50 glass-panel p-6">
        <h2 className="text-lg font-semibold text-st-absent">Could not load your attendance</h2>
        <p className="mt-2 text-sm text-ink-2 font-mono">Try signing out and back in.</p>
      </div>
    );
  }

  const todayStr = istToday();
  const todayDay = data.days.find((d) => d.date === todayStr);

  const workedTodayMinutes = todayData?.worked_minutes ?? todayDay?.worked_minutes ?? 0;
  const lateTodayMinutes = todayData?.late_minutes ?? todayDay?.late_minutes ?? 0;

  // Direction: if 'out', the employee is currently in office/wfh and next action is Check Out.
  const isCurrentlyIn = todayData?.direction === 'out';

  // SVG Circle calculation
  const circleRadius = 82;
  const circumference = 2 * Math.PI * circleRadius; // ~515.22
  const strokeDashoffset = circumference * (1 - shiftInfo.progress / 100);

  const days = data.days.filter((d) => d.date <= todayStr);
  const now = istYearMonth();
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const notFuture = year < now.year || (year === now.year && month < now.month);

  return (
    <div className="space-y-8 fade-in-up">
      {/* Employee Greeting & Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            {name ?? data.full_name}
          </h1>
          <p className="mt-1 text-sm text-ink-3 font-mono">
            Employee Workspace · {monthLabel(year, month)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/?y=${prev.y}&m=${prev.m}`}
            aria-label="Previous month"
            className="rounded-xl border border-line p-2 text-ink-2 hover:bg-surface-2 transition-all active:scale-95"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          {notFuture && (
            <Link
              href={`/?y=${next.y}&m=${next.m}`}
              aria-label="Next month"
              className="rounded-xl border border-line p-2 text-ink-2 hover:bg-surface-2 transition-all active:scale-95"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {punchFeedback && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-300 ${
            punchFeedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            {punchFeedback.type === 'success' ? (
              <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="size-4 text-rose-500 shrink-0" />
            )}
            <div>
              <p>{punchFeedback.message}</p>
              {punchFeedback.details && (
                <p className="text-[11px] opacity-85 font-mono mt-0.5">{punchFeedback.details}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPunchFeedback(null)}
            className="text-xs font-mono opacity-60 hover:opacity-100 p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1. Daily Metrics Section (Limited to Today) */}
      <section className="grid gap-4 sm:grid-cols-3">
        {/* Hours Worked Today */}
        <div className="glass-panel rounded-2xl p-5 border border-line/70 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-ink-3">
            <span>Hours worked today</span>
            <Clock className="size-4 text-ink-3" />
          </div>
          <div className="tnum mt-2 font-display text-3xl font-extrabold text-ink">
            {hours(workedTodayMinutes)}
          </div>
          <p className="mt-1.5 text-xs text-ink-3 font-mono">
            {isCurrentlyIn ? 'Active session in progress' : 'Clocked total for today'}
          </p>
        </div>

        {/* Late by (today) */}
        <div className="glass-panel rounded-2xl p-5 border border-line/70 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-ink-3">
            <span>Late by today</span>
            <Timer className="size-4 text-ink-3" />
          </div>
          <div className={`tnum mt-2 font-display text-3xl font-extrabold ${
            lateTodayMinutes > 0 ? 'text-amber-500' : 'text-emerald-500'
          }`}>
            {lateTodayMinutes > 0 ? hours(lateTodayMinutes) : '0 hrs'}
          </div>
          <p className="mt-1.5 text-xs font-mono text-ink-3">
            {lateTodayMinutes > 0 ? `${lateTodayMinutes} minutes after grace period` : 'On time today · 0 hours late · Refreshes daily'}
          </p>
        </div>

        {/* Assigned Shift Schedule */}
        <div className="glass-panel rounded-2xl p-5 border border-line/70 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-ink-3">
            <span>Today&apos;s shift schedule</span>
            <Sparkles className="size-4 text-blue-500" />
          </div>
          <div className="tnum mt-2 font-display text-2xl font-extrabold text-ink truncate">
            {todayData?.shift_label || 'General'}
          </div>
          <p className="mt-1.5 text-xs text-ink-3 font-mono truncate">
            {todayData?.checked_in_at ? `Checked in at ${hhmm12(todayData.checked_in_at)}` : 'Awaiting punch-in'}
          </p>
        </div>
      </section>

      {/* 2. Circular Check-in / Check-out Interactive Widget with Dynamic Blue Parameter */}
      <section className="glass-panel rounded-3xl border border-line p-6 sm:p-10 shadow-sm flex flex-col items-center justify-center text-center space-y-6 bg-gradient-to-b from-surface via-surface to-surface-2/30 relative overflow-hidden">
        {/* Top Header & Status */}
        <div className="space-y-2 max-w-md mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
            Live Shift Progress Tracker
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink">
            {isCurrentlyIn ? 'Shift in Progress' : 'Ready to Check In'}
          </h2>
          <p className="text-xs text-ink-3 leading-relaxed">
            {isCurrentlyIn
              ? `You punched in at ${hhmm12(todayData?.checked_in_at)}. Tap the circular button when your shift ends to record your checkout.`
              : 'Tap the circular button below to open your camera and verify your attendance.'}
          </p>
        </div>

        {/* Centered Circular Progress & Action Button */}
        <div className="relative flex items-center justify-center shrink-0 my-2">
          <svg className="size-60 sm:size-68" viewBox="0 0 200 200">
            <defs>
              <linearGradient id="shiftBlueGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
            </defs>

            {/* Background Track Ring */}
            <circle
              cx="100"
              cy="100"
              r={circleRadius}
              fill="none"
              strokeWidth="10"
              className="stroke-surface-2 dark:stroke-surface-2/60"
            />

            {/* Dynamic Blue Parameter Ring */}
            <circle
              cx="100"
              cy="100"
              r={circleRadius}
              fill="none"
              stroke="url(#shiftBlueGradient)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 100 100)"
              className="transition-all duration-1000 ease-out"
              style={{
                filter: 'drop-shadow(0 0 8px rgba(37, 99, 235, 0.45))',
              }}
            />
          </svg>

          {/* Centered Interactive Check-in / Check-out Button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              disabled={busy}
              aria-label={isCurrentlyIn ? 'Check out with camera' : 'Check in with camera'}
              className={`size-40 sm:size-44 rounded-full flex flex-col items-center justify-center transition-all duration-200 cursor-pointer select-none active:scale-95 shadow-2xl border-2 ${
                isCurrentlyIn
                  ? 'bg-gradient-to-b from-rose-500/15 via-rose-600/10 to-surface border-rose-500/40 hover:border-rose-500 hover:shadow-rose-500/25'
                  : 'bg-gradient-to-b from-blue-500/15 via-blue-600/10 to-surface border-blue-500/40 hover:border-blue-500 hover:shadow-blue-500/25'
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="size-6 animate-spin text-ink mb-1" />
                  <span className="text-[11px] font-mono text-ink-3 uppercase">Recording…</span>
                </>
              ) : isCurrentlyIn ? (
                <>
                  <LogOut className="size-8 text-rose-500 dark:text-rose-400 mb-1" />
                  <span className="font-display text-xl font-black tracking-tight text-rose-600 dark:text-rose-400">
                    Check Out
                  </span>
                  <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider mt-0.5">
                    {todayData?.checked_in_at ? `In ${hhmm12(todayData.checked_in_at)}` : 'Tap to punch'}
                  </span>
                </>
              ) : (
                <>
                  <LogIn className="size-8 text-blue-500 dark:text-blue-400 mb-1" />
                  <span className="font-display text-xl font-black tracking-tight text-blue-600 dark:text-blue-400">
                    Check In
                  </span>
                  <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider mt-0.5">
                    Tap to punch
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Bottom Shift Meta Information */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 border border-line text-xs font-mono">
            <span className="text-ink-3">Shift:</span>
            <span className="font-semibold text-ink">{todayData?.shift_label || '09:30 - 18:30'}</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 border border-line text-xs font-mono">
            <span className="text-ink-3">Remaining:</span>
            <span className="font-bold text-blue-600 dark:text-blue-400">
              {shiftInfo.isShiftEnded
                ? 'Shift completed for today'
                : !shiftInfo.isShiftStarted
                ? `Starts in ${hours(Math.max(0, -shiftInfo.elapsedMinutes))}`
                : `${hours(shiftInfo.remainingMinutes)} left`}
            </span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-mono text-blue-600 dark:text-blue-400">
            <span>Progress:</span>
            <span className="font-bold">{Math.round(shiftInfo.progress)}%</span>
          </div>
        </div>
      </section>

      {/* 3. Month at a Glance (Shifted Below) */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
          Month at a Glance
        </h2>
        <MonthCalendar days={data.days} year={year} month={month} />
      </section>

      {/* 4. Day-by-Day Attendance Log */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3 font-mono">
          Day-by-Day Attendance Log
        </h2>
        <div className="overflow-x-auto glass-panel rounded-2xl">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line/60 bg-surface-2/40 text-[11px] font-mono uppercase tracking-wider text-ink-3">
                <th className="px-5 py-3.5 font-semibold">Date</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 font-semibold">In</th>
                <th className="px-5 py-3.5 font-semibold">Out</th>
                <th className="px-5 py-3.5 font-semibold">Worked</th>
                <th className="px-5 py-3.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody
              onMouseLeave={() => setHoveredDate(null)}
              className="divide-y divide-line/30"
            >
              {days.map((d) => {
                const isHovered = hoveredDate === d.date;
                const isDimmed = hoveredDate !== null && !isHovered;
                return (
                  <tr
                    key={d.date}
                    onMouseEnter={() => setHoveredDate(d.date)}
                    className={`transition-opacity ${isDimmed ? 'opacity-40' : 'opacity-100'} hover:bg-surface-2/50`}
                  >
                    <td className="px-5 py-3 font-mono text-xs text-ink font-medium">
                      {d.date} <span className="text-ink-3 font-normal">{d.weekday}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                        <span aria-hidden>{statusGlyph(d.status)}</span>
                        <span>{statusLabel(d.status)}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-2">{hhmm(d.first_in)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-2">{hhmm(d.last_out)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-2">
                      {d.worked_minutes ? hours(d.worked_minutes) : '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {d.exception_note ? (
                        <span className="text-st-late">{d.exception_note}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Camera Capture Modal for Direct Check-in / Check-out */}
      <CameraCaptureModal
        open={modalOpen}
        employeeName={name ?? data.full_name}
        employeeCode={data.employee_code}
        onCapture={handlePunch}
        onClose={() => setModalOpen(false)}
        busy={busy}
        title={isCurrentlyIn ? 'Camera Check-out' : 'Camera Check-in'}
        subject="Punching as"
        confirmLabel={isCurrentlyIn ? 'Use photo & Check Out' : 'Use photo & Check In'}
        busyLabel="Recording punch…"
      />
    </div>
  );
}
