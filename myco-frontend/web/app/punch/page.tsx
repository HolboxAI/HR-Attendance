'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Camera,
  Coffee,
  Loader2,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { GlowingShadow } from '@/components/ui/glowing-shadow';

function PunchContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const actionParam = searchParams.get('action') || 'check_in';

  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string;
  } | null>(null);

  const [punchAction, setPunchAction] = useState<'check_in' | 'check_out' | 'break_out' | 'break_in'>('check_in');
  const cachedCoordsRef = useRef<{ lat: number; lng: number; accuracy: number; ts: number } | null>(null);

  useEffect(() => {
    if (['check_in', 'check_out', 'break_out', 'break_in'].includes(actionParam)) {
      setPunchAction(actionParam as any);
    }
  }, [actionParam]);

  // Pre-fetch location immediately
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

  // Automatically trigger camera modal on initial load if token is present
  useEffect(() => {
    if (token) {
      setModalOpen(true);
    }
  }, [token]);

  const handleCapture = async (file: File) => {
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
            timeout: 3000,
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
            details: 'Allow location permissions to verify office radius geofence.',
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
    form.append('punch_type', punchAction);
    if (punchAction === 'check_in' || punchAction === 'break_in') {
      form.append('direction', 'in');
    } else {
      form.append('direction', 'out');
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/gateway/api/v1/mobile/punch', {
      method: 'POST',
      headers,
      body: form,
    }).catch(() => null);

    setBusy(false);
    setModalOpen(false);

    if (!res) {
      setFeedback({
        type: 'error',
        message: 'Network error',
        details: 'Could not reach attendance server. Please try again.',
      });
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFeedback({
        type: 'error',
        message: body.detail || 'Punch rejected by system',
        details: 'Biometric face match or GPS location verification failed.',
      });
      return;
    }

    setFeedback({
      type: 'success',
      message: body.message || 'Verification Successful!',
      details: 'Attendance recorded and confirmed in Slack. You can now close this window.',
    });
  };

  const actionLabels: Record<string, { title: string; icon: any; color: string; desc: string }> = {
    check_in: { title: 'Clock In', icon: LogIn, color: 'text-emerald-400', desc: 'Verify identity & record check-in' },
    check_out: { title: 'Clock Out', icon: LogOut, color: 'text-rose-400', desc: 'Verify identity & conclude shift' },
    break_out: { title: 'Start Break', icon: Coffee, color: 'text-amber-400', desc: 'Clock out for tea/lunch/dinner' },
    break_in: { title: 'End Break', icon: Sparkles, color: 'text-blue-400', desc: 'Verify identity & resume work' },
  };

  const currentAction = actionLabels[punchAction] || actionLabels['check_in'];
  const IconComponent = currentAction.icon;

  return (
    <div className="min-h-screen bg-[#070A0F] text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background blur effects */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-md w-full relative z-10 flex flex-col items-center text-center">
        {/* Brand Header */}
        <div className="flex items-center gap-2 mb-8">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
            H
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Holbox Attendance</span>
        </div>

        {/* Card */}
        <div className="w-full bg-[#0D131F]/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/60 relative">
          <div className="h-16 w-16 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-5">
            <IconComponent className={`h-8 w-8 ${currentAction.color}`} />
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
            1-Click Biometric Punch
          </h1>
          <p className="text-sm text-slate-400 mb-6">
            {currentAction.desc}
          </p>

          {/* Feedback banner */}
          {feedback && (
            <div
              className={`p-4 rounded-xl border mb-6 text-left ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-start gap-3">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold text-sm">{feedback.message}</div>
                  {feedback.details && (
                    <div className="text-xs opacity-80 mt-1">{feedback.details}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action trigger button */}
          {!feedback || feedback.type === 'error' ? (
            <button
              onClick={() => setModalOpen(true)}
              disabled={busy}
              className="w-full py-4 px-6 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Verifying Face...</span>
                </>
              ) : (
                <>
                  <Camera className="h-5 w-5" />
                  <span>Open Camera to {currentAction.title}</span>
                </>
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-xs text-emerald-400/90 font-medium">
                <ShieldCheck className="h-4 w-4" />
                <span>Verified with Liveness & GPS</span>
              </div>
              <p className="text-xs text-slate-500">
                You can safely close this browser window and head back to Slack.
              </p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <p className="text-xs text-slate-500 mt-6">
          Protected by Holbox Biometric Geofence Intelligence
        </p>
      </div>

      <CameraCaptureModal
        open={modalOpen}
        employeeName="Holbox Employee"
        employeeCode="HOLBOX"
        title={`Biometric ${currentAction.title}`}
        subject={`Verifying face for ${currentAction.title}`}
        confirmLabel={`Verify & ${currentAction.title}`}
        busy={busy}
        onCapture={handleCapture}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}

export default function PunchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070A0F] text-slate-400 flex items-center justify-center">Loading...</div>}>
      <PunchContent />
    </Suspense>
  );
}
