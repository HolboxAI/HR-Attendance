'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, SwitchCamera, X } from 'lucide-react';

interface CameraCaptureModalProps {
  open: boolean;
  employeeName: string;
  employeeCode: string;
  onCapture: (file: File) => void;
  onClose: () => void;
  busy?: boolean;
}

export function CameraCaptureModal({
  open,
  employeeName,
  employeeCode,
  onCapture,
  onClose,
  busy = false,
}: CameraCaptureModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    let currentStream: MediaStream | null = null;
    setCameraError(null);

    async function startCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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

        currentStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play();
        }
      } catch (err: any) {
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

    // If front camera, mirror image for natural snapshot
    if (facingMode === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

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

  function retakePhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
  }

  function confirmUpload() {
    if (!capturedBlob) return;
    const filename = `${employeeCode}_photo_${Date.now()}.jpg`;
    const file = new File([capturedBlob], filename, { type: 'image/jpeg' });
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
            Face Photo Enrolment
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Taking reference photo for <strong className="text-ink">{employeeName}</strong> ({employeeCode})
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
            <div className="px-6 text-center text-xs text-st-absent flex flex-col items-center gap-2">
              <span className="text-2xl">📷⚠️</span>
              <p className="font-medium">{cameraError}</p>
              <p className="text-[11px] text-ink-3">
                You can also upload an existing image file using the file selector.
              </p>
            </div>
          ) : capturedBlob && previewUrl ? (
            /* Snapshot Preview */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt={`Captured photo for ${employeeName}`}
              className="w-full h-full object-cover"
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

        <p className="mt-3 text-center text-xs text-ink-3 max-w-xs font-mono">
          Ensure clean lighting, neutral expression, and direct front-facing alignment.
        </p>
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
                {busy ? 'Enrolling photo…' : 'Enrol Face Photo'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={snapPhoto}
              disabled={!!cameraError || !stream}
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
