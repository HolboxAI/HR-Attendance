'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  Coffee,
  HelpCircle,
  KeyRound,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  SwitchCamera,
  Upload,
  X,
} from 'lucide-react';
import { GlowingShadow } from '@/components/ui/glowing-shadow';

interface PunchResponse {
  accepted: boolean;
  emp_code: string;
  full_name: string;
  direction: string;
  punch_type: string;
  punched_at: string;
  face_similarity?: number | null;
  title?: string;
  message: string;
  break_duration_minutes?: number | null;
  break_duration_str?: string | null;
}

type PunchAction = 'check_in' | 'check_out' | 'break_out' | 'break_in';

function playSuccessChime() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const chord = [523.25, 659.25, 783.99, 1046.50];
    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.07 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.07);
      osc.stop(ctx.currentTime + idx * 0.07 + 0.5);
    });
  } catch {
    // Autoplay blocked or not supported
  }
}

export default function KioskPage() {
  // Terminal Lock / Auth State (default to false: renders lock screen immediately, no blocking spinner)
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [loginId, setLoginId] = useState('Holbox.ai');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Fullscreen state & iPad Modal
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIpadModal, setShowIpadModal] = useState(false);

  // Punch Flow state
  const [activeAction, setActiveAction] = useState<PunchAction | null>(null);
  const [step, setStep] = useState<'idle' | 'camera' | 'verifying' | 'result'>('idle');

  // Camera & Image state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Punch result
  const [punchResult, setPunchResult] = useState<PunchResponse | null>(null);
  const [countdown, setCountdown] = useState(4);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Read auth token from localStorage on mount (instantly unlocks if already authenticated)
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const auth = window.localStorage.getItem('bx_kiosk_auth');
        if (auth === 'true') {
          setIsAuthorized(true);
        }
      }
    } catch {
      // Storage restricted or disabled
    }
  }, []);

  // Handle Terminal Login
  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError(null);
    const trimmedId = loginId.trim().toLowerCase();
    const trimmedPin = loginPin.trim();

    if (trimmedId === 'holbox.ai' && trimmedPin === '1234') {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('bx_kiosk_auth', 'true');
        }
      } catch {
        // storage disabled or full
      }
      setIsAuthorized(true);
      setLoginPin('');
      setLoginError(null);
    } else {
      setLoginError('Invalid Terminal ID or PIN. Please enter Holbox.ai / 1234.');
    }
  };

  // Lock Terminal
  const handleLockTerminal = () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('bx_kiosk_auth');
      }
    } catch {}
    setIsAuthorized(false);
    setLoginPin('');
    setLoginError(null);
    resetToHome();
  };

  // Fullscreen listener
  useEffect(() => {
    const handleFsChange = () => {
      try {
        const doc = document as unknown as {
          fullscreenElement?: Element;
          webkitFullscreenElement?: Element;
          mozFullScreenElement?: Element;
        };
        setIsFullscreen(
          Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement)
        );
      } catch {}
    };

    try {
      document.addEventListener('fullscreenchange', handleFsChange);
      document.addEventListener('webkitfullscreenchange', handleFsChange);
    } catch {}

    return () => {
      try {
        document.removeEventListener('fullscreenchange', handleFsChange);
        document.removeEventListener('webkitfullscreenchange', handleFsChange);
      } catch {}
    };
  }, []);

  // Fullscreen toggle helper with iPad safety check
  const toggleFullscreen = () => {
    try {
      const doc = document as unknown as {
        fullscreenElement?: Element;
        webkitFullscreenElement?: Element;
        mozFullScreenElement?: Element;
        exitFullscreen?: () => Promise<void>;
        webkitExitFullscreen?: () => Promise<void>;
        mozCancelFullScreen?: () => Promise<void>;
      };
      const docEl = document.documentElement as unknown as {
        requestFullscreen?: () => Promise<void>;
        webkitRequestFullscreen?: () => Promise<void>;
        mozRequestFullScreen?: () => Promise<void>;
      };

      const hasFullscreenAPI =
        Boolean(docEl) &&
        (typeof docEl.requestFullscreen === 'function' ||
          typeof docEl.webkitRequestFullscreen === 'function' ||
          typeof docEl.mozRequestFullScreen === 'function');

      if (!hasFullscreenAPI) {
        // iPad Safari does not expose requestFullscreen on document/divs
        setShowIpadModal(true);
        return;
      }

      const isCurrent = Boolean(
        doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement
      );

      if (!isCurrent) {
        const req =
          docEl.requestFullscreen ||
          docEl.webkitRequestFullscreen ||
          docEl.mozRequestFullScreen;
        if (req) {
          req
            .call(docEl)
            .then(() => setIsFullscreen(true))
            .catch(() => setShowIpadModal(true));
        }
      } else {
        const exit =
          doc.exitFullscreen ||
          doc.webkitExitFullscreen ||
          doc.mozCancelFullScreen;
        if (exit) {
          exit
            .call(doc)
            .then(() => setIsFullscreen(false))
            .catch(() => {});
        }
      }
    } catch {
      setShowIpadModal(true);
    }
  };

  // Stop camera tracks cleanly
  const stopCameraTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Reset all modals back to the clean 4 cards
  const resetToHome = useCallback(() => {
    stopCameraTracks();
    setActiveAction(null);
    setStep('idle');
    setPunchResult(null);
    setCameraError(null);
  }, [stopCameraTracks]);

  // Inactivity timeout: auto-cancel if abandoned for 25s
  useEffect(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (step === 'camera' || step === 'result') {
      inactivityTimerRef.current = setTimeout(() => {
        resetToHome();
      }, 25_000);
    }
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [step, resetToHome]);

  // Start Camera Stream when entering 'camera' step
  useEffect(() => {
    if (step !== 'camera') {
      stopCameraTracks();
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setCameraActive(false);

    async function startCamera() {
      try {
        if (!navigator?.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          throw new Error('Camera access requires HTTPS or localhost in your browser.');
        }

        let mediaStream: MediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode,
              width: { ideal: 640 },
              height: { ideal: 640 },
            },
            audio: false,
          });
        } catch {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = mediaStream;
        setCameraActive(true);

        if (videoRef.current) {
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          videoRef.current.muted = true;
          videoRef.current.srcObject = mediaStream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => {});
          };
          videoRef.current.play().catch(() => {});
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unable to access camera';
        setCameraError(msg);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCameraTracks();
    };
  }, [step, facingMode, stopCameraTracks]);

  // Card tapped
  const handleCardClick = (action: PunchAction) => {
    setActiveAction(action);
    setStep('camera');
  };

  // Capture frame from video and submit
  const captureAndSubmit = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');

    const maxDim = 640;
    let w = video.videoWidth || 640;
    let h = video.videoHeight || 480;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        stopCameraTracks();
        submitPunch(blob);
      }
    }, 'image/jpeg', 0.85);
  };

  // Fallback file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCameraTracks();
    submitPunch(file);
  };

  // Submit Punch (1:N face search)
  const submitPunch = async (photoBlob: Blob) => {
    if (!activeAction) return;
    setStep('verifying');

    try {
      const form = new FormData();
      const filename = `kiosk_selfie_${Date.now()}.jpg`;
      form.append('selfie', photoBlob, filename);
      form.append('punch_type', activeAction);
      form.append('direction', activeAction === 'check_in' || activeAction === 'break_in' ? 'in' : 'out');

      const res = await fetch('/api/gateway/api/v1/kiosk/punch', {
        method: 'POST',
        body: form,
      });

      const rawData = await res.json().catch(() => null);
      const data: PunchResponse = {
        accepted: Boolean(rawData?.accepted),
        emp_code: rawData?.emp_code || '',
        full_name: rawData?.full_name || '',
        direction: rawData?.direction || (activeAction === 'check_in' || activeAction === 'break_in' ? 'in' : 'out'),
        punch_type: rawData?.punch_type || activeAction,
        punched_at: rawData?.punched_at || new Date().toISOString(),
        face_similarity: rawData?.face_similarity,
        title: rawData?.title || (rawData?.accepted ? 'Confirmed' : 'Action Required'),
        message: rawData?.message || rawData?.detail || (!res.ok ? 'Server returned an error processing your punch.' : ''),
        break_duration_minutes: rawData?.break_duration_minutes,
        break_duration_str: rawData?.break_duration_str,
      };

      setPunchResult(data);
      setStep('result');

      if (data.accepted) {
        playSuccessChime();
        setCountdown(4);
      } else {
        setCountdown(5);
      }
    } catch {
      setPunchResult({
        accepted: false,
        emp_code: '',
        full_name: '',
        direction: 'in',
        punch_type: activeAction,
        punched_at: new Date().toISOString(),
        message: 'Could not connect to attendance server. Please try again.',
      });
      setStep('result');
      setCountdown(4);
    }
  };

  // Auto-reset countdown
  useEffect(() => {
    if (step !== 'result') return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          resetToHome();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [step, resetToHome]);

  const actionLabels: Record<
    PunchAction,
    { title: string; subtitle: string; color: string; icon: typeof LogIn }
  > = {
    check_in: {
      title: 'Clock In',
      subtitle: 'Arriving at Office',
      color: 'bg-emerald-50 text-emerald-700',
      icon: LogIn,
    },
    check_out: {
      title: 'Clock Out',
      subtitle: 'Leaving for the Day',
      color: 'bg-rose-50 text-rose-700',
      icon: LogOut,
    },
    break_out: {
      title: 'Break Out',
      subtitle: 'Lunch / Tea Break',
      color: 'bg-amber-50 text-amber-700',
      icon: Coffee,
    },
    break_in: {
      title: 'Break In',
      subtitle: 'Resume Shift',
      color: 'bg-sky-50 text-sky-700',
      icon: Sparkles,
    },
  };

  const currentActionMeta = activeAction ? actionLabels[activeAction] : null;

  // 1. KIOSK AUTHENTICATION / LOCK SCREEN (Rendered immediately when unauthenticated)
  if (!isAuthorized) {
    return (
      <div className="relative min-h-screen bg-slate-50 flex items-center justify-center p-6 select-none font-sans">
        <div className="w-full max-w-md bg-white rounded-3xl p-8 sm:p-10 shadow-2xl border border-slate-200/80 flex flex-col items-center">
          {/* Logo / Badge */}
          <div className="size-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-6 shadow-xs">
            <Lock className="size-8" />
          </div>

          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold tracking-wide uppercase mb-2">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Holbox Terminal
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Kiosk Locked
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Enter terminal credentials to unlock this attendance device.
            </p>
          </div>

          {loginError && (
            <div className="w-full mb-6 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-2.5 text-xs font-semibold text-rose-700">
              <AlertCircle className="size-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Terminal ID
              </label>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="Holbox.ai"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Terminal PIN / Password
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value)}
                placeholder="••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
            </div>

            <button
              type="submit"
              className="w-full mt-2 py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md shadow-indigo-600/25 active:scale-98 transition-all cursor-pointer"
            >
              <LockOpen className="size-4" />
              Unlock Terminal
            </button>
          </form>

          <p className="text-[11px] text-slate-400 text-center mt-6 leading-relaxed">
            Locked for attendance terminal security.<br />
            Once unlocked, you can safely lock Guided Access on this iPad.
          </p>
        </div>
      </div>
    );
  }

  // 2. MAIN KIOSK VIEW (UNLOCKED)
  return (
    <div className="relative min-h-screen bg-white text-zinc-900 flex flex-col select-none overflow-hidden font-sans">
      {/* Top Left: Subtle Lock Terminal Button */}
      <button
        type="button"
        onClick={handleLockTerminal}
        className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-white/90 backdrop-blur-sm text-zinc-600 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 transition-all shadow-xs text-xs font-bold cursor-pointer"
        title="Lock Terminal"
      >
        <Lock className="size-3.5" />
        <span>Lock Terminal</span>
      </button>

      {/* Top Right: Fullscreen Toggle */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className="absolute top-6 right-6 z-20 p-2.5 rounded-xl border border-zinc-200 bg-white/90 backdrop-blur-sm text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors shadow-xs cursor-pointer"
        title="Toggle Fullscreen"
      >
        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>

      {/* Main 4 Cards View */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 max-w-5xl mx-auto w-full">
        <div className="text-center mb-8">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-zinc-900 tracking-tight">
            Tap an action to verify your face
          </h2>
        </div>

        {/* 4 Large Touch Cards with High-Visibility Glowing Edges */}
        <div className="grid grid-cols-2 gap-6 w-full max-w-3xl">
          {/* 1. CLOCK IN */}
          <GlowingShadow
            edgeColor="emerald"
            onClick={() => handleCardClick('check_in')}
            className="w-full active:scale-95 transition-transform duration-150"
          >
            <div className="flex flex-col items-center text-center gap-4 p-8 w-full select-none">
              <div className="size-20 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-inner">
                <LogIn className="size-10" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">
                  Clock In
                </h3>
                <p className="text-xs text-zinc-500 mt-1 font-medium">Arriving at office</p>
              </div>
              <span className="mt-2 text-xs font-semibold px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-800">
                Tap to Scan Face
              </span>
            </div>
          </GlowingShadow>

          {/* 2. CLOCK OUT */}
          <GlowingShadow
            edgeColor="rose"
            onClick={() => handleCardClick('check_out')}
            className="w-full active:scale-95 transition-transform duration-150"
          >
            <div className="flex flex-col items-center text-center gap-4 p-8 w-full select-none">
              <div className="size-20 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shadow-inner">
                <LogOut className="size-10" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">
                  Clock Out
                </h3>
                <p className="text-xs text-zinc-500 mt-1 font-medium">Leaving for the day</p>
              </div>
              <span className="mt-2 text-xs font-semibold px-4 py-1.5 rounded-full bg-rose-100 text-rose-800">
                Tap to Scan Face
              </span>
            </div>
          </GlowingShadow>

          {/* 3. BREAK OUT */}
          <GlowingShadow
            edgeColor="amber"
            onClick={() => handleCardClick('break_out')}
            className="w-full active:scale-95 transition-transform duration-150"
          >
            <div className="flex flex-col items-center text-center gap-4 p-8 w-full select-none">
              <div className="size-20 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-inner">
                <Coffee className="size-10" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">
                  Break Out
                </h3>
                <p className="text-xs text-zinc-500 mt-1 font-medium">Lunch / Tea break</p>
              </div>
              <span className="mt-2 text-xs font-semibold px-4 py-1.5 rounded-full bg-amber-100 text-amber-800">
                Tap to Scan Face
              </span>
            </div>
          </GlowingShadow>

          {/* 4. BREAK IN */}
          <GlowingShadow
            edgeColor="sky"
            onClick={() => handleCardClick('break_in')}
            className="w-full active:scale-95 transition-transform duration-150"
          >
            <div className="flex flex-col items-center text-center gap-4 p-8 w-full select-none">
              <div className="size-20 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center shadow-inner">
                <Sparkles className="size-10" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">
                  Break In
                </h3>
                <p className="text-xs text-zinc-500 mt-1 font-medium">Resume work</p>
              </div>
              <span className="mt-2 text-xs font-semibold px-4 py-1.5 rounded-full bg-sky-100 text-sky-800">
                Tap to Scan Face
              </span>
            </div>
          </GlowingShadow>
        </div>
      </main>

      {/* IPAD FULLSCREEN & GUIDED ACCESS MODAL */}
      {showIpadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-zinc-200 flex flex-col items-center relative">
            <button
              type="button"
              onClick={() => setShowIpadModal(false)}
              className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
            >
              <X className="size-5" />
            </button>

            <div className="size-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-4 shadow-xs">
              <Maximize2 className="size-7" />
            </div>

            <h3 className="text-xl font-bold text-zinc-900 text-center">iPad Fullscreen Setup</h3>
            <p className="text-xs text-zinc-500 text-center mt-1 mb-5">
              Apple Safari requires web apps to be added to the Home Screen for true borderless full screen.
            </p>

            <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-700 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="size-6 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center shrink-0 text-xs">
                  1
                </span>
                <p className="pt-0.5">
                  Tap the Safari <strong>Share button (⎋)</strong> in the top toolbar.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <span className="size-6 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center shrink-0 text-xs">
                  2
                </span>
                <p className="pt-0.5">
                  Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <span className="size-6 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center shrink-0 text-xs">
                  3
                </span>
                <p className="pt-0.5">
                  Open <strong>Holbox Kiosk</strong> from your iPad Home Screen. It will launch in full screen with zero address bars!
                </p>
              </div>

              <div className="flex items-start gap-3">
                <span className="size-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center shrink-0 text-xs">
                  4
                </span>
                <p className="pt-0.5">
                  Triple-click the Top or Home button to start <strong>Guided Access</strong> and lock the kiosk.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIpadModal(false)}
              className="w-full mt-6 py-3.5 px-6 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* CAMERA SCAN MODAL */}
      {step === 'camera' && currentActionMeta && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 flex flex-col items-center gap-5 relative">
            <button
              type="button"
              onClick={resetToHome}
              className="absolute top-5 right-5 p-2 rounded-xl text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
            >
              <X className="size-5" />
            </button>

            {/* Modal Title */}
            <div className="text-center">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${currentActionMeta.color}`}>
                {currentActionMeta.title}
              </span>
              <h3 className="text-xl font-bold text-zinc-900 mt-2">Position Your Face in the Circle</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Look directly at the front camera</p>
            </div>

            {/* Circular Camera Viewfinder */}
            <div className="relative size-72 sm:size-80 rounded-full overflow-hidden border-4 border-indigo-600 shadow-xl bg-zinc-900 flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className={`size-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />
              {/* Facial Alignment Target Guide */}
              <div className="absolute inset-4 rounded-full border border-dashed border-white/40 pointer-events-none" />

              {cameraError && (
                <div className="absolute inset-0 bg-zinc-900/95 p-6 text-center flex flex-col items-center justify-center gap-3 z-10">
                  <div className="size-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <Camera className="size-7" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Camera Access</h4>
                    <p className="text-[11px] text-zinc-300 mt-1 max-w-[240px] leading-relaxed">
                      {cameraError}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 w-full max-w-[220px]">
                    {typeof window !== 'undefined' && window.location.protocol === 'http:' && (
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = window.location.href.replace('http:', 'https:');
                        }}
                        className="cursor-pointer px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/25 active:scale-95 transition-all"
                      >
                        Switch to HTTPS
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="cursor-pointer px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-indigo-600/25 active:scale-95 transition-all"
                    >
                      <Camera className="size-4" />
                      Take Photo with Camera
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Buttons */}
            {!cameraError && (
              <div className="w-full flex items-center justify-between gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
                  className="p-3.5 rounded-2xl border border-zinc-200 text-zinc-700 hover:bg-zinc-100 flex items-center gap-2 text-xs font-bold transition-colors cursor-pointer"
                >
                  <SwitchCamera className="size-4" />
                  Flip
                </button>

                <button
                  type="button"
                  onClick={captureAndSubmit}
                  className="flex-1 py-4 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-base shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
                >
                  <Camera className="size-5" />
                  Scan & Verify
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={resetToHome}
              className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* VERIFYING STATE */}
      {step === 'verifying' && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl border border-zinc-200 flex flex-col items-center text-center gap-4">
            <div className="relative size-20 rounded-full bg-indigo-50 flex items-center justify-center">
              <RefreshCw className="size-10 text-indigo-600 animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-900">Recognizing Face</h3>
              <p className="text-xs text-zinc-500 mt-1">
                Matching selfie against enrolled employee records...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* RESULT CONFIRMATION */}
      {step === 'result' && punchResult && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in zoom-in-95 duration-150">
          <div
            className={`w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl border-2 flex flex-col items-center text-center gap-5 relative ${
              punchResult.accepted ? 'border-emerald-500' : 'border-rose-500'
            }`}
          >
            {/* Status Icon */}
            {punchResult.accepted ? (
              <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-md animate-bounce">
                <CheckCircle2 className="size-12" />
              </div>
            ) : (
              <div className="size-20 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 shadow-md">
                <AlertCircle className="size-12" />
              </div>
            )}

            <div>
              <h2 className="text-2xl font-black text-zinc-900">
                {punchResult.title || (punchResult.accepted ? 'Confirmed' : 'Action Required')}
              </h2>
              <p
                className={`text-sm font-semibold mt-2 leading-relaxed ${
                  punchResult.accepted ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {punchResult.message}
              </p>
            </div>

            {/* Break Duration Stat */}
            {punchResult.break_duration_str && (
              <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-between text-xs text-amber-900 font-semibold shadow-xs">
                <span className="text-amber-700 font-medium">Break Duration</span>
                <span className="font-bold text-sm font-mono text-amber-950">{punchResult.break_duration_str}</span>
              </div>
            )}

            {/* Match Stats */}
            {punchResult.accepted && (
              <div className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl p-4 flex items-center justify-around text-xs">
                <div>
                  <span className="text-zinc-500 block text-[11px] font-medium">Employee</span>
                  <span className="text-zinc-900 font-bold text-sm">{punchResult.full_name}</span>
                </div>
                <div className="w-px h-8 bg-zinc-200" />
                <div>
                  <span className="text-zinc-500 block text-[11px] font-medium">Employee Code</span>
                  <span className="text-zinc-900 font-mono font-bold text-sm">{punchResult.emp_code}</span>
                </div>
              </div>
            )}

            {/* Done / Try Again */}
            <div className="w-full flex flex-col gap-2 mt-2">
              <button
                type="button"
                onClick={resetToHome}
                className={`w-full py-3.5 px-6 rounded-2xl font-bold text-sm transition-all active:scale-95 cursor-pointer ${
                  punchResult.accepted
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                }`}
              >
                {punchResult.accepted ? 'Done' : 'Try Again'}
              </button>
              <p className="text-[11px] text-zinc-400">
                Screen will reset in {countdown}s
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for native device camera fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleFileChange}
        className="hidden"
      />
      {/* Hidden canvas for offscreen image capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
