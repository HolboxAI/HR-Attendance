'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, MapPin, XCircle } from 'lucide-react';

import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { hhmm12 } from '@/lib/format';

/**
 * Check in from the dashboard - the same pipeline as the phone, and the page
 * tells the truth about every stage of it.
 *
 * The first version of this page reported success whenever the HTTP call
 * succeeded, invented similarity percentages ("97%", "98%"), fabricated a
 * whole success on network failure, and carried office coordinates ~5km east
 * of the office - so a REFUSED punch (wrong face, wrong place) rendered as
 * "recorded successfully", and Krish's real attempt from home surfaced as a
 * mystery error. The punch API answers 200 for refusals too: `accepted`
 * decides, `message` explains, and both come from the server or not at all.
 */

// Measured on site 2026-08-27 - not a map pin. Keep in sync with
// apps/api/app/core/office.py.
const OFFICE = { lat: 23.03479, lng: 72.53238 };

/**
 * This browser's stable handset identity, minted once and remembered - the
 * same thing the phone app does with its install id. Editable in the UI
 * because watching the binding refuse a wrong id is half the demonstration.
 */
function defaultHandsetId(): string {
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

type Today = {
  fullName: string;
  employeeCode: string;
  shiftLabel: string;
  direction: 'in' | 'out';
  statusLabel: string;
};

type Feedback = {
  type: 'success' | 'error';
  message: string;
  details?: string;
  /** Set when the failure is "this browser is not a registered handset". */
  offerRegister?: boolean;
};

export default function CheckinPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useOfficeCoords, setUseOfficeCoords] = useState(false);
  const [handsetId, setHandsetId] = useState(defaultHandsetId);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Kept so "register this browser" can retry the same captured selfie
  // instead of sending the person back through the camera.
  const lastFile = useRef<File | null>(null);

  const loadToday = useCallback(async () => {
    setLoadError(null);
    const res = await fetch('/api/gateway/api/v1/mobile/me').catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setLoadError(body?.detail ?? 'Could not load your status');
      return;
    }
    const j = await res.json();
    setToday({
      fullName: j.full_name,
      employeeCode: j.employee_code,
      shiftLabel: j.shift_label,
      direction: j.direction,
      statusLabel: j.checked_in_at
        ? `in at ${hhmm12(j.checked_in_at)}${j.checked_out_at ? `, out at ${hhmm12(j.checked_out_at)}` : ''}`
        : 'not checked in yet',
    });
  }, []);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  async function punch(file: File) {
    lastFile.current = file;
    setBusy(true);
    setFeedback(null);

    let lat = OFFICE.lat;
    let lng = OFFICE.lng;
    let accuracy = 15;
    if (!useOfficeCoords) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
          }),
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracy = Math.round(pos.coords.accuracy || 15);
      } catch {
        // No silent fallback to office coordinates: a punch that quietly
        // claims to be at the office when location was denied is exactly the
        // kind of evidence this system exists to not manufacture.
        setFeedback({
          type: 'error',
          message: 'Location permission was denied or unavailable.',
          details:
            'Allow location for this site, or tick "use office coordinates" for an off-site demo.',
        });
        setBusy(false);
        setModalOpen(false);
        return;
      }
    }

    const form = new FormData();
    form.append('selfie', file, 'punch.jpg');
    form.append('lat', String(lat));
    form.append('lng', String(lng));
    form.append('accuracy_m', String(accuracy));
    form.append('is_mocked', 'false');
    // No direction field: the server alternates from the last accepted punch.

    const res = await fetch('/api/gateway/api/v1/mobile/punch', {
      method: 'POST',
      headers: { 'X-Install-Id': handsetId },
      body: form,
    }).catch(() => null);

    setBusy(false);
    setModalOpen(false);

    if (!res) {
      setFeedback({ type: 'error', message: 'Could not reach the server.' });
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail: string = body?.detail ?? `The server answered ${res.status}.`;
      setFeedback({
        type: 'error',
        message: detail,
        offerRegister: res.status === 403 && detail.includes('not registered'),
      });
      return;
    }

    // 200 does NOT mean accepted. Refusals arrive with accepted:false and the
    // reason in `message` - distance, face mismatch, unreadable photo.
    const data = await res.json();
    const parts: string[] = [];
    if (data.face_similarity !== null && data.face_similarity !== undefined) {
      parts.push(`Face similarity ${Number(data.face_similarity).toFixed(1)} (threshold 90)`);
    }
    if (data.distance_m !== null && data.distance_m !== undefined) {
      parts.push(`${Math.round(data.distance_m)}m from the office`);
    }
    if (data.accepted) {
      setFeedback({
        type: 'success',
        message: data.message,
        details: parts.join(' · ') || undefined,
      });
      loadToday();
    } else {
      setFeedback({
        type: 'error',
        message: data.message,
        details: parts.join(' · ') || undefined,
      });
    }
  }

  /** The exit from "this browser is not registered": bind it, then retry. */
  async function registerAndRetry() {
    setBusy(true);
    const res = await fetch('/api/gateway/api/v1/mobile/register-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': handsetId },
      body: JSON.stringify({ platform: 'web', model: 'Dashboard browser' }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setFeedback({
        type: 'error',
        message: body?.detail ?? 'Could not register this browser.',
        details:
          'If your account is bound to another device, HR can clear it from the Devices page.',
      });
      return;
    }
    if (lastFile.current) await punch(lastFile.current);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Page Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          Check in
        </h1>
        <p className="mt-1 text-sm text-ink-3 leading-relaxed max-w-2xl">
          The same pipeline as the phone: camera, location, device binding, then a face comparison against your enrolled photo. Whoever is signed in is who punches — there is no way to punch as someone else.
        </p>
      </div>

      {/* Top Status Strip Pill */}
      {loadError ? (
        <div className="bg-surface border border-rose-500/30 rounded-xl px-5 py-3.5 text-sm text-rose-600 dark:text-rose-400 shadow-xs">
          {loadError}
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 shadow-xs">
          <span className="font-semibold text-ink text-sm">
            {today?.fullName ?? 'Loading…'}
          </span>
          <span className="font-mono text-xs text-ink-3 uppercase tracking-wider font-semibold">
            {today?.employeeCode ?? ''}
          </span>
          <span className="text-xs text-ink-2">
            {today ? `shift ${today.shiftLabel}` : ''}
          </span>
          <span className="text-xs text-ink-3 ml-auto font-medium">
            {today?.statusLabel ?? ''}
          </span>
        </div>
      )}

      {/* Main Action Box */}
      <div className="bg-surface border border-line rounded-2xl p-6 sm:p-7 shadow-xs space-y-6">
        {/* Big Action Button */}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={busy || !today}
          className="w-full bg-[#b85800] hover:bg-[#a14800] active:scale-[0.99] text-white font-semibold py-4 px-6 rounded-xl flex items-center justify-center gap-2.5 transition-all shadow-sm cursor-pointer text-base disabled:opacity-60"
        >
          <Camera className="size-5" />
          <span>{today?.direction === 'out' ? 'Check out with camera' : 'Check in with camera'}</span>
        </button>

        {/* Office Coordinates Checkbox */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-ink-2 group">
          <input
            type="checkbox"
            checked={useOfficeCoords}
            onChange={(e) => setUseOfficeCoords(e.target.checked)}
            className="size-4 rounded border-line text-[#b85800] focus:ring-[#b85800] accent-[#b85800] cursor-pointer"
          />
          <MapPin className="size-3.5 text-ink-3 group-hover:text-ink transition-colors shrink-0" />
          <span>
            Use office coordinates (for demoing off-site — otherwise your real browser location is sent)
          </span>
        </label>

        {/* Handset ID Section */}
        <div className="space-y-2 pt-2 border-t border-line/50">
          <div className="text-[10px] font-mono font-bold tracking-wider text-ink-3 uppercase">
            HANDSET ID — THE DEVICE-BINDING CHECK, MADE VISIBLE
          </div>
          <input
            type="text"
            value={handsetId}
            onChange={(e) => setHandsetId(e.target.value)}
            className="w-full bg-surface-2 border border-line rounded-lg px-3.5 py-2.5 text-xs font-mono text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition-colors"
          />
          <p className="text-[11px] text-ink-3 leading-relaxed">
            On a phone this is invisible plumbing. This browser minted its own
            id and remembers it. Change it to anything else and the API refuses
            you like a borrowed phone.
          </p>
        </div>

        {/* Result / Feedback Banner */}
        {feedback && (
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 transition-all ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="size-5 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="size-5 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-sm">{feedback.message}</p>
              {feedback.details && <p className="opacity-90">{feedback.details}</p>}
              {feedback.offerRegister && (
                <button
                  type="button"
                  onClick={registerAndRetry}
                  disabled={busy}
                  className="mt-1 rounded-lg border border-current px-3 py-1.5 font-semibold cursor-pointer disabled:opacity-50"
                >
                  Register this browser as my handset &amp; retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Camera Capture Modal */}
      <CameraCaptureModal
        open={modalOpen}
        employeeName={today?.fullName ?? ''}
        employeeCode={today?.employeeCode ?? ''}
        onCapture={punch}
        onClose={() => setModalOpen(false)}
        busy={busy}
      />
    </div>
  );
}
