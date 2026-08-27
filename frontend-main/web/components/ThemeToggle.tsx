'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';

type Mode = 'light' | 'dark' | 'system';
const KEY = 'bx-theme';

function systemDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(mode: Mode) {
  const dark = mode === 'dark' || (mode === 'system' && systemDark());
  // The flag lives on <html> so the root layout's before-paint script and
  // this toggle agree on one mechanism. CSS scopes it to #bx-shell.
  document.documentElement.classList.toggle('bx-dark-mode', dark);
}

/**
 * Light / dark / system, persisted per browser. The dashboard defaults to
 * light; the sign-in page is deliberately untouched (it has its own approved
 * dark design and lives outside #bx-shell). An inline script in the layout
 * applies the stored choice before first paint so there is no flash.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY) as Mode | null;
      if (stored) setMode(stored);
    } catch { /* private mode - default stands */ }
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  function cycle() {
    const next: Mode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
    setMode(next);
    try { localStorage.setItem(KEY, next); } catch { /* fine */ }
    applyTheme(next);
  }

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : SunMoon;
  const label = mode === 'light' ? 'Light theme' : mode === 'dark' ? 'Dark theme' : 'System theme';

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${label} - click to change`}
      aria-label={`${label}. Activate to switch theme.`}
      className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
