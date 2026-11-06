'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, LogOut, ShieldAlert } from 'lucide-react';

// Strict compliance: 15 minutes total inactivity
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (900,000 ms)
const WARNING_DURATION_MS = 60 * 1000; // 60 seconds warning
const WARNING_START_MS = INACTIVITY_TIMEOUT_MS - WARNING_DURATION_MS; // 14 minutes (840,000 ms)
const STORAGE_KEY = 'bx_last_active_ts';

export function InactivityTimeout() {
  const router = useRouter();
  const [warningVisible, setWarningVisible] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(60);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const lastActiveRef = useRef<number>(Date.now());
  const throttleRef = useRef<number>(0);

  // Synchronize and reset activity timestamp
  function recordActivity() {
    const now = Date.now();
    // Throttle localStorage updates to at most once every 1500ms
    if (now - throttleRef.current > 1500) {
      throttleRef.current = now;
      lastActiveRef.current = now;
      try {
        localStorage.setItem(STORAGE_KEY, String(now));
      } catch {
        // Ignore storage errors in restricted private browsing
      }
      if (warningVisible) {
        setWarningVisible(false);
      }
    }
  }

  // Graceful sign-out on timeout
  async function performLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch('/api/session', { method: 'DELETE' });
    } catch {
      // Ignore network failures on signout
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    // Redirect to login with reason=timeout
    window.location.href = '/login?reason=timeout';
  }

  // "Stay Signed In" button handler
  function handleStaySignedIn() {
    const now = Date.now();
    lastActiveRef.current = now;
    throttleRef.current = now;
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // Ignore
    }
    setWarningVisible(false);

    // Ping auth gateway in background to keep backend session and cookies alive
    fetch('/api/gateway/api/v1/auth/me').catch(() => undefined);
  }

  useEffect(() => {
    // Initialize or load latest timestamp from storage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= Date.now()) {
          lastActiveRef.current = parsed;
        } else {
          localStorage.setItem(STORAGE_KEY, String(Date.now()));
        }
      } else {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      }
    } catch {
      // Ignore
    }

    // Activity event listeners
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    const onUserActivity = () => {
      // If warning modal is showing, require an explicit click on "Stay Signed In"
      // so random background mouse twitches don't dismiss the security alert
      if (!warningVisible) {
        recordActivity();
      }
    };

    events.forEach((evt) => {
      window.addEventListener(evt, onUserActivity, { passive: true });
    });

    // Multi-tab synchronization: if user is active in Tab A, Tab B syncs and resets
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const remoteTime = parseInt(e.newValue, 10);
        if (!isNaN(remoteTime)) {
          lastActiveRef.current = remoteTime;
          if (Date.now() - remoteTime < WARNING_START_MS) {
            setWarningVisible(false);
          }
        }
      }
    };
    window.addEventListener('storage', onStorageChange);

    // Heartbeat check interval: runs every 1 second
    const interval = setInterval(() => {
      // Check stored timestamp from localStorage in case another tab updated it
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed > lastActiveRef.current) {
            lastActiveRef.current = parsed;
          }
        }
      } catch {
        // Ignore
      }

      const elapsed = Date.now() - lastActiveRef.current;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        clearInterval(interval);
        performLogout();
      } else if (elapsed >= WARNING_START_MS) {
        const remaining = Math.max(0, Math.ceil((INACTIVITY_TIMEOUT_MS - elapsed) / 1000));
        setRemainingSeconds(remaining);
        setWarningVisible(true);
      } else {
        if (warningVisible) {
          setWarningVisible(false);
        }
      }
    }, 1000);

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, onUserActivity);
      });
      window.removeEventListener('storage', onStorageChange);
      clearInterval(interval);
    };
  }, [warningVisible]);

  if (!warningVisible) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in select-none"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="inactivity-title"
      aria-describedby="inactivity-desc"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/20 bg-ground/95 p-7 shadow-2xl backdrop-blur-2xl text-ink">
        {/* Ambient Top Glow */}
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/20 rounded-full blur-3xl" />

        <div className="relative flex flex-col items-center text-center space-y-4">
          {/* Pulsing Security Shield Icon */}
          <div className="relative flex items-center justify-center size-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 shadow-lg shadow-amber-500/10">
            <ShieldAlert className="size-8 animate-pulse" />
            <div className="absolute inset-0 rounded-2xl ring-2 ring-amber-500/20 animate-ping opacity-75 pointer-events-none" />
          </div>

          <div className="space-y-1.5">
            <h2 id="inactivity-title" className="text-xl font-bold tracking-tight text-ink font-display">
              Session Expiring Soon
            </h2>
            <p id="inactivity-desc" className="text-xs text-muted font-body leading-relaxed max-w-xs mx-auto">
              You have been inactive for 14 minutes. For security and to protect confidential employee records, you will be logged out in:
            </p>
          </div>

          {/* Large Countdown Badge */}
          <div className="my-2 inline-flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500">
            <Clock className="size-5 animate-spin" style={{ animationDuration: '6s' }} />
            <span className="font-mono text-2xl font-bold tracking-widest">{timeFormatted}</span>
          </div>

          {/* Action Buttons */}
          <div className="w-full pt-2 flex flex-col-reverse sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={performLogout}
              disabled={isLoggingOut}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold rounded-xl border border-line bg-surface/60 hover:bg-surface text-muted hover:text-ink transition-all cursor-pointer disabled:opacity-50"
            >
              <LogOut className="size-4" />
              <span>Log Out Now</span>
            </button>

            <button
              type="button"
              onClick={handleStaySignedIn}
              disabled={isLoggingOut}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold rounded-xl bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/25 transition-all cursor-pointer font-display disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>Stay Signed In</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
