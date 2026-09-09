'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, SwitchCamera, UploadCloud, X } from 'lucide-react';

interface CameraCaptureModalProps {
  open: boolean;
  employeeName: string;
  employeeCode: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  busy?: boolean;
  /** The modal serves two very different moments - enrolling a reference
      photo and punching in. The words must say which one is happening, so
      the caller names the action; enrolment stays the default. */
  title?: string;
  subject?: string;
  confirmLabel?: string;
  busyLabel?: string;
  /** A server-side refusal (duplicate face, bad quality). Shown INSIDE the
      modal: the row-level error behind the dialog backdrop is invisible
      while this is open, and a silent failure reads as "try again". */
  error?: string | null;
}

export function CameraCaptureModal({
  open,
  employeeName,
  employeeCode,
  onCapture,
  onClose,
  busy = false,
  title = 'Face Photo Enrolment',
  subject = 'Taking reference photo for',
  confirmLabel = 'Enrol Face Photo',
  busyLabel = 'Enrolling photo\u2026',
  error = null,
}: CameraCaptureModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Check for camera devices
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      }).catch(() => undefined);
    }
  }, []);

  // Handle native dialog open/close
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Start video stream when opened and in capture mode
  useEffect(() => {
    if (!open || capturedBlob) return;

    // Two invariants this effect must hold, both learned from a real bug
    // ("The play() request was interrupted because the media was removed
    // from the document" painted over the viewfinder):
    //
    // 1. A getUserMedia that resolves AFTER this effect was cleaned up
    //    (React re-running effects, a quick close-reopen, HMR) must stop
    //    its own tracks and go away - otherwise two streams fight over one
    //    <video>, each interrupting the other's load.
    // 2. An interrupted play() is NOT a camera failure. The element has
    //    autoPlay and recovers on its own; surfacing the interruption as
    //    an error swapped the <video> out for the error panel, which then
    //    guaranteed the "media was removed" rejection it was reporting.
    let cancelled = false;
    let currentStream: MediaStream | null = null;
    setCameraError(null);

    async function startCamera() {
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          const isSecure = typeof window !== 'undefined' && window.isSecureContext;
          if (!isSecure) {
            throw new Error('Live camera is disabled by browsers on HTTP (requires HTTPS/SSL). You can upload or snap a photo directly from your device below.');
          }
          throw new Error('Camera access is not supported in this browser.');
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        currentStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => {
            /* benign interruption - autoPlay retries with the stream set */
          });
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('Camera initialization error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('Camera access was denied. Please allow camera permissions in your browser.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setCameraError('No camera device was detected on your computer or device.');
        } else {
          setCameraError(err.message ?? 'Failed to access camera.');
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [open, facingMode, capturedBlob]);

  // Clean up object url
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function stopTracks() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }

  function handleClose() {
    stopTracks();
    setCapturedBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onClose();
  }

  function snapPhoto() {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Use actual video dimensions
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The CAPTURE is not mirrored. The live preview is (CSS scaleX(-1),
    // like every selfie camera), but this frame goes to Rekognition to be
    // compared against an enrolment photo that was taken unmirrored - and a
    // flipped face costs similarity points against a non-flipped reference
    // for no reason. Vanity gets the preview; identity gets the pixels.
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);
          stopTracks();
        }
      },
      'image/jpeg',
      0.92,
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturedBlob(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    stopTracks();
  }

  function retakePhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
      setCameraError(null);
    }
  }

  function confirmUpload() {
    if (!capturedBlob) return;
    let file: File;
    if (capturedBlob instanceof File) {
      file = capturedBlob;
    } else {
      const filename = `${employeeCode}_photo_${Date.now()}.jpg`;
      file = new File([capturedBlob], filename, { type: 'image/jpeg' });
    }
    stopTracks();
    onCapture(file);
  }

  function toggleCamera() {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onCancel={handleClose}
      className="bx-pop m-auto w-full max-w-lg rounded-2xl glass-panel p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-md border border-line/80 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line/60 px-5 py-4 bg-surface/50">
        <div>
          <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
            <Camera className="size-4 text-accent" />
            {title}
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            {subject} <strong className="text-ink">{employeeName}</strong> ({employeeCode})
          </p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={busy}
          className="rounded-xl p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Camera Viewfinder or Preview Area */}
      <div className="p-5 flex flex-col items-center">
        <div className="relative w-full aspect-square max-w-[360px] rounded-2xl overflow-hidden bg-black border border-line/80 shadow-inner flex items-center justify-center">
          {cameraError ? (
            <div className="px-6 text-center text-xs flex flex-col items-center justify-center gap-3 p-6 h-full w-full bg-zinc-950/80">
              <div className="size-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-sm">
                <Camera className="size-7" />
              </div>
              <div className="space-y-1.5 max-w-xs text-center">
                <p className="font-semibold text-ink text-xs leading-snug">{cameraError}</p>
                <p className="text-[11px] text-ink-3 leading-relaxed">
                  Select an existing selfie or snap a photo using your device below.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ink text-ground text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-md cursor-pointer mt-1"
              >
                <UploadCloud className="size-4" />
                <span>Choose / Take Photo</span>
              </button>
            </div>
          ) : capturedBlob && previewUrl ? (
            /* Snapshot Preview */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt={`Captured photo for ${employeeName}`}
              // Mirrored for DISPLAY only, so the still matches what the live
              // preview showed. The underlying file is unmirrored - see the
              // capture comment above.
              className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
            />
          ) : (
            /* Live Video Feed */
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
              />
              {/* Face Framing Oval Guide */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-[65%] h-[80%] rounded-[50%] border-2 border-dashed border-accent/70 shadow-lg flex items-end justify-center pb-4">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-accent bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-xs">
                    Align Face Here
                  </span>
                </div>
              </div>

              {/* Camera Switcher Button (if multiple cameras exist) */}
              {hasMultipleCameras && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm transition-all border border-white/20 active:scale-95"
                  title="Switch camera"
                >
                  <SwitchCamera className="size-4" />
                </button>
              )}
            </>
          )}
        </div>

        {/* Hidden off-screen canvas for frame capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Hidden file input for direct photo upload fallback */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handleFileChange}
        />

        {!cameraError && !capturedBlob && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-2.5 text-[11px] text-ink-3 hover:text-ink underline transition-colors cursor-pointer"
          >
            Or choose a photo file from device
          </button>
        )}

        {error ? (
          <p
            role="alert"
            className="mt-3 w-full max-w-[360px] rounded-xl border border-st-absent/50 bg-st-absent/10 px-3.5 py-2.5 text-center text-xs font-medium text-st-absent"
          >
            <span aria-hidden>⚠️ </span>{error}
          </p>
        ) : (
          <p className="mt-3 text-center text-xs text-ink-3 max-w-xs font-mono">
            Ensure clean lighting, neutral expression, and direct front-facing alignment.
          </p>
        )}
      </div>

      {/* Actions Footer */}
      <div className="flex items-center justify-between border-t border-line/60 bg-surface/40 px-5 py-4">
        <button
          type="button"
          onClick={handleClose}
          disabled={busy}
          className="rounded-xl border border-line/80 px-3.5 py-2 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-50"
        >
          Cancel
        </button>

        <div className="flex items-center gap-2.5">
          {capturedBlob ? (
            <>
              <button
                type="button"
                onClick={retakePhoto}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line/80 px-3.5 py-2 text-xs font-medium text-ink hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                <RefreshCw className="size-3.5 text-accent" />
                Retake
              </button>
              <button
                type="button"
                onClick={confirmUpload}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-bold text-surface shadow-md hover:bg-accent/90 transition-all disabled:opacity-50 active:scale-95"
              >
                {busy ? busyLabel : confirmLabel}
              </button>
            </>
          ) : cameraError ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-bold text-surface shadow-md hover:bg-accent/90 transition-all active:scale-95 cursor-pointer"
            >
              <UploadCloud className="size-3.5" />
              Choose Photo
            </button>
          ) : (
            <button
              type="button"
              onClick={snapPhoto}
              disabled={!stream}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs font-bold text-surface shadow-md hover:bg-accent/90 transition-all disabled:opacity-50 active:scale-95"
            >
              <div className="size-3 rounded-full bg-surface border border-accent/40" />
              Capture Photo
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
