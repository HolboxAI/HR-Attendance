'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, MapPin } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { hhmm12, proxy } from '@/lib/format';

/**
 * Check in from the dashboard - the roadmap's "an admin can mark their own
 * attendance without reaching for their phone", and the standing demo of the
 * whole verification pipeline.
 *
 * Everything goes through the REAL endpoints. The camera frame is posted to
 * /mobile/punch exactly as a handset would post its selfie: same geofence,
 * same device-binding check, same Rekognition comparison against the enrolled
 * reference photo. Identity comes from the session token - there is no
 * employee field to send, so this page cannot punch as anyone but whoever is
 * signed in.
 *
 * The handset-id field is visible on purpose. On a phone it is invisible
 * plumbing; here it is half the demonstration - type the wrong one and the
 * API refuses you the same way it would refuse a borrowed phone.
 */

const OFFICE = { lat: 23.03479, lng: 72.53238 };

type Today = {
  employee_code: string;
  full_name: string;
  direction: 'in' | 'out';
  checked_in_at: string | null;
  checked_out_at: string | null;
  worked_minutes: number;
  shift_label: string;
  office_name: string;
};

type PunchResult = {
  accepted: boolean;
  direction: 'in' | 'out';
  punched_at: string;
  distance_m: number | null;
  face_similarity: number | null;
  message: string;
  attendance_status: string | null;
  worked_minutes: number | null;
};

type Phase = 'idle' | 'camera' | 'sending' | 'done';

export default function CheckinPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [installId, setInstallId] = useState('demo-handset-bx001');
  const [useOffice, setUseOffice] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadToday = useCallback(async () => {
    setTodayError(null);
    const res = await fetch(proxy('/api/v1/mobile/me')).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setTodayError(body?.detail ?? 'Could not load your status');
      return;
    }
    setToday(await res.json());
  }, []);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // The stream must be released whatever path leaves the camera phase, or the
  // "camera in use" light stays on after the punch - which reads as spyware,
  // not attendance.
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function openCamera() {
    setCameraError(null);
    setResult(null);
    setFailure(null);
    try {
      // Front camera, like the phone. The permission prompt the browser shows
      // here IS the moment the mobile app asks for camera access.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('camera');
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setCameraError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access for this site in the browser settings, then try again.'
          : name === 'NotFoundError'
            ? 'No camera was found on this machine.'
            : 'Could not open the camera.',
      );
    }
  }

  function capture(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return resolve(null);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
    });
  }

  function realPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10_000,
      }),
    );
  }

  async function punch() {
    setFailure(null);
    const selfie = await capture();
    if (!selfie) {
      setFailure('Could not capture a frame from the camera.');
      return;
    }
    stopCamera();
    setPhase('sending');

    let lat = OFFICE.lat;
    let lng = OFFICE.lng;
    let accuracy = 15;
    if (!useOffice) {
      try {
        const pos = await realPosition();
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracy = Math.round(pos.coords.accuracy);
      } catch {
        setFailure(
          'Location permission was denied or unavailable. Allow it, or tick "use office coordinates" for an off-site demo.',
        );
        setPhase('idle');
        return;
      }
    }

    const form = new FormData();
    form.append('selfie', selfie, 'selfie.jpg');
    form.append('lat', String(lat));
    form.append('lng', String(lng));
    form.append('accuracy_m', String(accuracy));
    form.append('is_mocked', 'false');
    // No direction field: the server alternates from the last accepted punch,
    // exactly as it does for the phone.

    const res = await fetch(proxy('/api/v1/mobile/punch'), {
      method: 'POST',
      headers: { 'X-Install-Id': installId },
      body: form,
    }).catch(() => null);

    if (!res) {
      setFailure('Could not reach the server.');
      setPhase('idle');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setFailure(body?.detail ?? `The server answered ${res.status}.`);
      setPhase('idle');
      return;
    }
    setResult(await res.json());
    setPhase('done');
    loadToday();
  }

  const actionLabel = today?.direction === 'out' ? 'Check out' : 'Check in';

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="Check in"
        sub="The same pipeline as the phone: camera, location, device binding, then a face comparison against your enrolled photo. Whoever is signed in is who punches."
      />

      {todayError ? (
        <div className="bx-card border-st-absent/50 p-5 text-sm">
          <p className="font-medium">Cannot punch from this account</p>
          <p className="mt-1 text-ink-2">{todayError}</p>
        </div>
      ) : today ? (
        <div className="bx-card flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4 text-sm">
          <span className="font-medium">{today.full_name}</span>
          <span className="text-ink-3">{today.employee_code}</span>
          <span className="text-ink-2">shift {today.shift_label}</span>
          <span className="text-ink-2">
            {today.checked_in_at
              ? `in at ${hhmm12(today.checked_in_at)}${today.checked_out_at ? `, out at ${hhmm12(today.checked_out_at)}` : ''}`
              : 'not checked in yet'}
          </span>
        </div>
      ) : (
        <div className="bx-card p-4 text-sm text-ink-3">Loading your day…</div>
      )}

      <div className="bx-card space-y-4 p-5">
        {phase === 'camera' ? (
          <>
            {/* Mirrored like every selfie camera; the captured frame itself is not. */}
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full rounded-md bg-black object-cover [transform:scaleX(-1)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={punch}
                className="flex-1 rounded-md bg-accent px-4 py-2.5 font-semibold text-white"
              >
                Capture &amp; {actionLabel.toLowerCase()}
              </button>
              <button
                type="button"
                onClick={() => { stopCamera(); setPhase('idle'); }}
                className="rounded-md border border-line px-4 py-2.5 text-sm text-ink-2"
              >
                Cancel
              </button>
            </div>
          </>
        ) : phase === 'sending' ? (
          <p className="py-10 text-center text-sm text-ink-2">
            Verifying — device, location, then your face…
          </p>
        ) : (
          <button
            type="button"
            onClick={openCamera}
            disabled={!today}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            <Camera className="size-4" aria-hidden />
            {actionLabel} with camera
          </button>
        )}

        {cameraError && (
          <p role="alert" className="text-sm text-st-absent">
            <span aria-hidden>○ </span>{cameraError}
          </p>
        )}
        {failure && (
          <p role="alert" className="text-sm text-st-absent">
            <span aria-hidden>○ </span>{failure}
          </p>
        )}

        <div className="space-y-2 border-t border-line pt-4 text-sm">
          <label className="flex items-center gap-2 text-ink-2">
            <input
              type="checkbox"
              checked={useOffice}
              onChange={(e) => setUseOffice(e.target.checked)}
            />
            <MapPin className="size-3.5" aria-hidden />
            Use office coordinates (for demoing off-site — otherwise your real
            browser location is sent)
          </label>
          <label className="block text-ink-2">
            <span className="mb-1 block text-xs uppercase tracking-widest text-ink-3">
              Handset id — the device-binding check, made visible
            </span>
            <input
              value={installId}
              onChange={(e) => setInstallId(e.target.value)}
              className="w-full rounded border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink"
            />
            <span className="mt-1 block text-xs text-ink-3">
              On a phone this is invisible plumbing. Change it to anything else
              and the API refuses you like a borrowed phone.
            </span>
          </label>
        </div>
      </div>

      {result && (
        <div
          className={`bx-card p-5 ${result.accepted ? 'border-st-present/50' : 'border-st-absent/50'}`}
        >
          <p className={`text-lg font-semibold ${result.accepted ? 'text-st-present' : 'text-st-absent'}`}>
            <span aria-hidden>{result.accepted ? '● ' : '○ '}</span>
            {result.accepted ? 'Attendance recorded' : 'Refused'}
          </p>
          <p className="mt-1 text-sm text-ink">{result.message}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {result.face_similarity !== null ? (
              <>
                <dt className="text-ink-3">Face match</dt>
                <dd className="tnum">
                  {result.face_similarity.toFixed(1)} similarity (threshold 90)
                </dd>
              </>
            ) : (
              <>
                <dt className="text-ink-3">Face check</dt>
                <dd>{result.accepted ? 'not performed — no reference photo' : '—'}</dd>
              </>
            )}
            {result.distance_m !== null && (
              <>
                <dt className="text-ink-3">Distance from office</dt>
                <dd className="tnum">{Math.round(result.distance_m)}m</dd>
              </>
            )}
            {result.attendance_status && (
              <>
                <dt className="text-ink-3">Day so far</dt>
                <dd>{result.attendance_status}</dd>
              </>
            )}
          </dl>
          {result.accepted && (
            <p className="mt-3 text-sm">
              <Link href="/board" className="text-accent underline underline-offset-4">
                See it on the board →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
