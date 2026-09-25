'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
} from 'lucide-react';

import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { GlowingShadow } from '@/components/ui/glowing-shadow';
import { hhmm12, hours } from '@/lib/format';

type Today = {
  fullName: string;
  employeeCode: string;
  shiftLabel: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  direction: 'in' | 'out';
  isCurrentlyIn?: boolean;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  breakMinutes?: number;
  lateMinutes: number;
};

type Feedback = {
  type: 'success' | 'error';
  message: string;
  details?: string;
};

function formatWorkHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function getIstMinutesNow(): number {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istDate = new Date(utc + 3600000 * 5.5);
  return istDate.getHours() * 60 + istDate.getMinutes();
}

export default function CheckinPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [currentMinuteOfDay, setCurrentMinuteOfDay] = useState(getIstMinutesNow);
  const cachedCoordsRef = useRef<{ lat: number; lng: number; accuracy: number; ts: number } | null>(null);

  const prefetchLocation = useCallback(() => {
    if (typeof window === 'undefined' || !navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cachedCoordsRef.current = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 15),
          ts: Date.now(),
        };
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 4000 }
    );
  }, []);

  useEffect(() => {
    prefetchLocation();
  }, [prefetchLocation]);

  // Update current time every 30 seconds for live shift tracker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentMinuteOfDay(getIstMinutesNow());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const loadToday = useCallback(async () => {
    setLoadError(null);
    const res = await fetch('/api/gateway/api/v1/mobile/me').catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setLoadError(body?.detail ?? 'Could not load your attendance status');
      return;
    }
    const j = await res.json();
    setToday({
      fullName: j.full_name,
      employeeCode: j.employee_code,
      shiftLabel: j.shift_label,
      shiftStart: j.shift_start,
      shiftEnd: j.shift_end,
      direction: j.direction,
      isCurrentlyIn: j.is_currently_in ?? (j.direction === 'out'),
      checkedInAt: j.checked_in_at,
      checkedOutAt: j.checked_out_at,
      workedMinutes: j.worked_minutes ?? 0,
      breakMinutes: j.break_minutes ?? 0,
      lateMinutes: j.late_minutes ?? 0,
    });
  }, []);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // Shift progress calculations
  const shiftInfo = useMemo(() => {
    const rawLabel = today?.shiftLabel || '09:30 - 18:30';
    let startStr = today?.shiftStart;
    let endStr = today?.shiftEnd;

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
  }, [today, currentMinuteOfDay]);

  // Is currently checked in?
  const isCurrentlyIn = today?.isCurrentlyIn ?? (today?.direction === 'out');
  const liveWorkedMinutes = today?.workedMinutes ?? 0;

  // Progress towards 8h / shift daily work target
  const targetWorkMinutes = Math.max(480, (shiftInfo.totalMinutes || 540) - 60);
  const workProgress = Math.min(100, Math.max(0, (liveWorkedMinutes / targetWorkMinutes) * 100));

  // SVG Circle calculation
  const circleRadius = 82;
  const circumference = 2 * Math.PI * circleRadius; // ~515.22
  const strokeDashoffset = circumference * (1 - workProgress / 100);

  async function punch(file: File) {
    setBusy(true);
    setFeedback(null);

    const cached = cachedCoordsRef.current;
    const isFresh = cached && Date.now() - cached.ts < 120_000;
    let lat: number;
    let lng: number;
    let accuracy: number;
    if (isFresh && cached) {
      lat = cached.lat;
      lng = cached.lng;
      accuracy = cached.accuracy;
    } else {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            maximumAge: 60_000,
            timeout: 2500,
          }),
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracy = Math.round(pos.coords.accuracy || 15);
        cachedCoordsRef.current = { lat, lng, accuracy, ts: Date.now() };
      } catch {
        if (cached) {
          lat = cached.lat;
          lng = cached.lng;
          accuracy = cached.accuracy;
        } else {
          setFeedback({
            type: 'error',
            message: 'Location permission was denied or unavailable.',
            details: 'Allow location for this site, then try again. Check-in needs your real position.',
          });
          setBusy(false);
          setModalOpen(false);
          return;
        }
      }
    }

    const form = new FormData();
    form.append('selfie', file, 'punch.jpg');
    form.append('lat', String(lat));
    form.append('lng', String(lng));
    form.append('accuracy_m', String(accuracy));
    form.append('is_mocked', 'false');

    const res = await fetch('/api/gateway/api/v1/mobile/punch', {
      method: 'POST',
      body: form,
    }).catch(() => null);

    setBusy(false);
    setModalOpen(false);

    if (!res) {
      setFeedback({ type: 'error', message: 'Could not connect to authentication gateway.' });
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setFeedback({
        type: 'error',
        message: body?.detail ?? `The server answered ${res.status}.`,
      });
      return;
    }

    const data = await res.json();
    const parts: string[] = [];
    if (data.face_similarity !== null && data.face_similarity !== undefined) {
      parts.push(`Face similarity ${Number(data.face_similarity).toFixed(1)}%`);
    }
    if (data.distance_m !== null && data.distance_m !== undefined) {
      parts.push(`${Math.round(data.distance_m)}m from office`);
    }

    if (data.accepted) {
      setFeedback({
        type: 'success',
        message: data.message || (isCurrentlyIn ? 'Checked out successfully!' : 'Checked in successfully!'),
        details: parts.join(' · ') || undefined,
      });
      await loadToday();
    } else {
      setFeedback({
        type: 'error',
        message: data.message || 'Punch refused by verification pipeline.',
        details: parts.join(' · ') || undefined,
      });
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 fade-in-up py-4">
      {/* Top Error Alert */}
      {loadError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-2xl px-5 py-3.5 text-xs font-mono flex items-center gap-2.5">
          <AlertCircle className="size-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Main Interactive Circular Widget */}
      <section className="glass-panel rounded-3xl border border-line p-6 sm:p-10 shadow-sm flex flex-col items-center justify-center text-center space-y-6 bg-gradient-to-b from-surface via-surface to-surface-2/30 relative overflow-visible">
        {/* Top Header & Live Tracker Pill */}
        <div className="space-y-2 max-w-md mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
            Live Shift Progress Tracker
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink tracking-tight">
            {isCurrentlyIn ? 'Shift in Progress' : 'Ready to Check In'}
          </h1>
          <p className="text-xs sm:text-sm text-ink-3 leading-relaxed">
            {isCurrentlyIn
              ? `You punched in at ${today?.checkedInAt ? hhmm12(today.checkedInAt) : 'today'}. Tap the circular button when your shift ends to record your checkout.`
              : 'Tap the circular button below to open your camera and verify your attendance.'}
          </p>
        </div>

        {/* Centered Circular Progress & Action Button */}
        <div className="relative flex items-center justify-center shrink-0 my-2">
          <svg className="size-60 sm:size-68" viewBox="0 0 200 200">
            <defs>
              <linearGradient id="shiftBlueGradientCheckin" x1="0%" y1="0%" x2="100%" y2="100%">
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
              stroke="url(#shiftBlueGradientCheckin)"
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
              onClick={() => {
                prefetchLocation();
                setModalOpen(true);
              }}
              disabled={busy || !today}
              aria-label={isCurrentlyIn ? 'Check out with camera' : 'Check in with camera'}
              className="size-40 sm:size-44 rounded-full p-0 border-0 bg-transparent cursor-pointer select-none active:scale-95 disabled:opacity-70 disabled:cursor-wait"
            >
              <GlowingShadow variant="circle">
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
                      {today?.checkedInAt ? `In ${hhmm12(today.checkedInAt)}` : 'Tap to punch'}
                    </span>
                  </>
                ) : (
                  <>
                    <LogIn className="size-8 text-blue-500 dark:text-blue-400 mb-1" />
                    <span className="font-display text-xl font-black tracking-tight text-blue-600 dark:text-blue-400">
                      {today?.checkedInAt ? 'Resume / In' : 'Check In'}
                    </span>
                    <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider mt-0.5">
                      {today?.checkedOutAt ? `Out at ${hhmm12(today.checkedOutAt)}` : 'Tap to punch'}
                    </span>
                  </>
                )}
              </GlowingShadow>
            </button>
          </div>
        </div>

        {/* Bottom Shift Information Badges */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 border border-line text-xs font-mono">
            <span className="text-ink-3">Shift:</span>
            <span className="font-semibold text-ink">{shiftInfo.startStr} - {shiftInfo.endStr}</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 border border-line text-xs font-mono">
            <span className="text-ink-3">Worked Today:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatWorkHours(liveWorkedMinutes)}
            </span>
          </div>

          {(today?.breakMinutes ?? 0) > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 border border-line text-xs font-mono">
              <span className="text-ink-3">Breaks:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                {today?.breakMinutes}m
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-mono text-blue-600 dark:text-blue-400">
            <span>Status:</span>
            <span className="font-bold">
              {isCurrentlyIn ? 'In Office' : today?.checkedInAt ? 'On Break' : 'Not In'}
            </span>
          </div>
        </div>

        {/* Feedback / Result Alert */}
        {feedback && (
          <div
            className={`w-full max-w-md p-4 rounded-2xl border flex items-center justify-between gap-3 text-left animate-in fade-in slide-in-from-top-2 duration-300 ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2.5 text-xs font-semibold">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
              ) : (
                <AlertCircle className="size-4 text-rose-500 shrink-0" />
              )}
              <div>
                <p>{feedback.message}</p>
                {feedback.details && (
                  <p className="text-[11px] opacity-85 font-mono mt-0.5">{feedback.details}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs font-mono opacity-60 hover:opacity-100 p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

      </section>

      {/* Camera Capture Modal */}
      <CameraCaptureModal
        open={modalOpen}
        employeeName={today?.fullName ?? ''}
        employeeCode={today?.employeeCode ?? ''}
        onCapture={punch}
        onClose={() => setModalOpen(false)}
        busy={busy}
        title={isCurrentlyIn ? 'Camera Check-Out' : 'Camera Check-In'}
        subject="Punching as"
        confirmLabel="Verify Face & Punch"
        busyLabel="Verifying…"
      />
    </div>
  );
}
