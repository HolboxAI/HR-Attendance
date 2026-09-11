'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, UploadCloud, CheckCircle2, Sparkles, ShieldCheck,
  AlertCircle, RefreshCw, SwitchCamera, ArrowRight, Trophy, Zap
} from 'lucide-react';
import { HolboxMark } from '@/components/ui/boxcode-logo';

interface OnboardingGuideProps {
  employeeName: string | null;
  employeeCode: string | null;
  onCompleted: () => void;
}

export function OnboardingGuide({
  employeeName,
  employeeCode,
  onCompleted,
}: OnboardingGuideProps) {
  // Stages: 1 = Briefing, 2 = Biometric Capture / Upload, 3 = Mission Complete
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [method, setMethod] = useState<'camera' | 'file'>('camera');

  // Camera & Image state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Submission state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize camera stream when entering stage 2 in camera mode
  useEffect(() => {
    if (stage !== 2 || method !== 'camera' || capturedBlob) {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        setStream(null);
      }
      return;
    }

    let active = true;
    async function startCamera() {
      setCameraError(null);
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        if (!active) return;
        setCameraError(
          'Unable to access camera. Please allow camera permissions or upload an image file instead.'
        );
      }
    }

    startCamera();

    return () => {
      active = false;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stage, method, facingMode, capturedBlob]);

  // Clean up preview blob URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Capture snapshot from webcam
  function takeSnapshot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Flip horizontally for natural mirror feel on selfie camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setError(null);
      },
      'image/jpeg',
      0.92
    );
  }

  // Handle file picker selection
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (JPG or PNG).');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('Photo size exceeds 8 MB. Please choose a smaller photo.');
      return;
    }

    setCapturedBlob(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setError(null);
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function submitBiometrics() {
    if (!capturedBlob || busy) return;

    setBusy(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('photo', capturedBlob, 'reference.jpg');

      const res = await fetch('/api/gateway/api/v1/profile/photo', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.detail || data.message || 'Photo was rejected by facial quality verification.');
        setBusy(false);
        return;
      }

      // First-time enrollment is auto-approved by the API
      setStage(3);
    } catch {
      setError('Network connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] backdrop-blur-2xl bg-black/85 flex items-center justify-center p-4 sm:p-6 overflow-y-auto pointer-events-auto">
      {/* Hidden canvas for snapshot rasterization */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={handleFileSelect}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-xl rounded-3xl border border-white/15 bg-surface/95 backdrop-blur-3xl shadow-2xl p-6 sm:p-8 relative overflow-hidden"
      >
        {/* Glow ambient background element */}
        <div className="absolute -top-24 -right-24 size-48 rounded-full bg-blue-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 size-48 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />

        {/* Top game-style quest header */}
        <div className="flex items-center justify-between border-b border-line pb-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
              New Employee Quest • Mission 1
            </span>
          </div>
          <div className="text-[11px] font-mono text-ink-3">
            Step {stage} of 2
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* ================= STAGE 1: MISSION BRIEFING ================= */}
          {stage === 1 && (
            <motion.div
              key="briefing"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-6"
            >
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="size-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center p-3 shadow-inner">
                  <HolboxMark className="w-full h-full" />
                </div>
                <div>
                  <h2 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-ink">
                    Welcome to Holbox, {employeeName || 'Team Member'}!
                  </h2>
                  <p className="text-xs sm:text-sm text-ink-3 mt-1 max-w-md">
                    To enable instant biometric check-ins and verify your shift attendance, we need to register your reference facial profile.
                  </p>
                </div>
              </div>

              {/* Game quest perk callouts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="p-3.5 rounded-2xl bg-surface-2 border border-line flex items-start gap-3">
                  <div className="size-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                    <Zap className="size-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-ink">Instant Auto-Activation</h4>
                    <p className="text-[11px] text-ink-3 mt-0.5">
                      Your first photo is verified and activated immediately—no admin waiting required!
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-surface-2 border border-line flex items-start gap-3">
                  <div className="size-8 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
                    <ShieldCheck className="size-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-ink">Biometric Security</h4>
                    <p className="text-[11px] text-ink-3 mt-0.5">
                      Allows fast 1-second check-in directly from your phone or kiosk.
                    </p>
                  </div>
                </div>
              </div>

              {/* Guideline alert */}
              <div className="p-3 rounded-xl bg-surface-2/60 border border-line text-[11px] text-ink-2 space-y-1">
                <span className="font-bold text-ink flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-blue-400" />
                  Tips for a valid photo:
                </span>
                <p className="text-ink-3 pl-5">
                  • Ensure your face is clearly lit and centered in the frame.
                  <br />
                  • Look directly into the lens with a neutral expression.
                  <br />
                  • Avoid dark sunglasses, masks, or hats.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setStage(2)}
                className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all active:scale-[0.99] cursor-pointer"
              >
                <span>Start Mission: Enroll Face Biometrics</span>
                <ArrowRight className="size-4" />
              </button>
            </motion.div>
          )}

          {/* ================= STAGE 2: FACE CAPTURE / UPLOAD ================= */}
          {stage === 2 && (
            <motion.div
              key="capture"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="space-y-5"
            >
              {/* Method tabs */}
              <div className="flex items-center gap-2 p-1 rounded-2xl bg-surface-2 border border-line">
                <button
                  type="button"
                  onClick={() => {
                    setMethod('camera');
                    retake();
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    method === 'camera'
                      ? 'bg-surface text-ink shadow-xs border border-line'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <Camera className="size-3.5" />
                  <span>Take Live Photo (Webcam)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMethod('file');
                    retake();
                  }}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    method === 'file'
                      ? 'bg-surface text-ink shadow-xs border border-line'
                      : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  <UploadCloud className="size-3.5" />
                  <span>Upload File (JPG / PNG)</span>
                </button>
              </div>

              {/* Viewfinder / Preview Frame */}
              <div className="relative aspect-square w-full max-w-[340px] mx-auto rounded-3xl overflow-hidden bg-black border-2 border-dashed border-line flex items-center justify-center shadow-inner">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Captured portrait"
                    className="w-full h-full object-cover"
                  />
                ) : method === 'camera' ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${
                        facingMode === 'user' ? 'scale-x-[-1]' : ''
                      }`}
                    />
                    {/* Face Oval Guideline Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-[62%] h-[75%] rounded-[50%] border-2 border-dashed border-emerald-400/70 shadow-[0_0_15px_rgba(52,211,153,0.3)] animate-pulse" />
                    </div>
                  </>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-3 p-6 text-center cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    <div className="size-14 rounded-2xl bg-surface-2 border border-line flex items-center justify-center text-ink-3">
                      <UploadCloud className="size-7 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-ink">Click to select photo</p>
                      <p className="text-[11px] text-ink-3 mt-0.5">JPEG or PNG up to 8 MB</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Camera Error Alert */}
              {cameraError && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <p>{cameraError}</p>
                </div>
              )}

              {/* Verification Error Alert */}
              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              {/* Control Buttons */}
              <div className="space-y-2">
                {previewUrl ? (
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={retake}
                      disabled={busy}
                      className="flex-1 h-11 rounded-xl bg-surface-2 hover:bg-surface-2/80 text-ink text-xs font-bold transition-all cursor-pointer"
                    >
                      Retake Photo
                    </button>
                    <button
                      type="button"
                      onClick={submitBiometrics}
                      disabled={busy}
                      className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {busy ? (
                        <>
                          <RefreshCw className="size-3.5 animate-spin" />
                          <span>Verifying Biometrics…</span>
                        </>
                      ) : (
                        <>
                          <span>Activate Biometrics</span>
                          <ArrowRight className="size-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                ) : method === 'camera' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
                      className="px-3.5 h-11 rounded-xl bg-surface-2 border border-line text-ink-3 hover:text-ink transition-colors cursor-pointer"
                      title="Switch Camera"
                    >
                      <SwitchCamera className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={takeSnapshot}
                      className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-blue-500/20"
                    >
                      <Camera className="size-4" />
                      <span>Snap Picture</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-11 rounded-xl bg-surface-2 hover:bg-surface-2/80 text-ink text-xs font-bold transition-all cursor-pointer"
                  >
                    Choose Image File
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* ================= STAGE 3: MISSION ACCOMPLISHED ================= */}
          {stage === 3 && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6 text-center py-4"
            >
              <div className="size-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500 flex items-center justify-center mx-auto text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
                <Trophy className="size-9 animate-bounce" />
              </div>

              <div className="space-y-1">
                <h3 className="font-display text-2xl font-black text-ink">
                  Mission Accomplished!
                </h3>
                <p className="text-xs text-ink-3 max-w-sm mx-auto">
                  Your facial biometrics have been verified and activated immediately. You are ready to punch in for shifts.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 text-left space-y-1 max-w-sm mx-auto">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="size-4" />
                  <span>Biometric Profile Active</span>
                </div>
                <p className="text-[11px] text-emerald-400/80 pl-6">
                  Reference photo stored under code {employeeCode || 'active'}. You do not need to wait for HR approval!
                </p>
              </div>

              <button
                type="button"
                onClick={onCompleted}
                className="w-full h-12 rounded-2xl bg-white text-black font-bold text-sm shadow-xl hover:bg-white/90 transition-all active:scale-[0.99] cursor-pointer"
              >
                Enter Attendance Dashboard →
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
