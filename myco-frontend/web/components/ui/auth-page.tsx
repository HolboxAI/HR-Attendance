'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AtSignIcon, LockIcon, EyeIcon, EyeOffIcon, ArrowRightIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { BoxcodeLogo, BoxcodeMark } from './boxcode-logo';
import { Button } from './button';
import HeroText from './hero-shutter-text';
import { Input } from './input';
import { SpotlightCursor } from './spotlight-cursor';
import { CanvasRevealEffect } from './sign-in-flow-1';
import Link from 'next/link';

export function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail ?? 'Sign in failed');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full bg-black text-white overflow-hidden lg:grid lg:grid-cols-2">
      <SpotlightCursor config={{ radius: 120 }} />

      {/* Global Background Dot Matrix Canvas Animation from sign-in-flow-1 */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <CanvasRevealEffect
          animationSpeed={3}
          containerClassName="bg-black"
          colors={[
            [255, 255, 255],
            [255, 255, 255],
          ]}
          dotSize={4}
          showGradient={true}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,0.85)_0%,_transparent_100%)]" />
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black to-transparent" />
      </div>

      {/* Left Brand Showcase Column (Desktop only) */}
      <div className="relative isolate hidden h-full flex-col justify-between border-r border-white/10 p-10 lg:flex z-10">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center p-1.5 backdrop-blur-md shadow-xs">
            <BoxcodeLogo className="size-full text-white" />
          </div>
          <div className="flex flex-col">
            {/* Plain text on purpose - the shutter treatment belongs to the
                big product name in the centre, not the corner mark. */}
            <span className="font-display text-sm font-bold tracking-tight text-white">Holbox</span>
            <span className="text-[10px] text-white/50 font-mono">Workforce Portal</span>
          </div>
        </div>

        {/* The welcome block: plain lead-in, then the product name under the shutter treatment */}
        <div className="my-auto flex flex-col items-center gap-6 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-white/50 font-mono">Welcome to</p>
          <HeroText text="HOLBOX" />
          <BoxcodeMark className="size-16 text-white/70" />
        </div>
      </div>

      {/* Right Sign-in Form Column */}
      <div className="relative flex min-h-screen flex-col justify-center items-center p-6 z-10">
        <motion.div
          // y only, NEVER opacity: this column is the login form, and a form
          // that starts at opacity 0 exists only if the animation runs. With
          // a full-screen WebGL canvas booting beside it, a stalled first
          // frame left the right half of the page blank - rarely, and always
          // for whoever was trying to sign in. Motion may decorate the form;
          // it does not get to gate it.
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md space-y-6 rounded-3xl glass-panel p-8 sm:p-10 border border-white/10 bg-black/40 backdrop-blur-2xl shadow-2xl"
        >
          <div className="flex items-center gap-3 lg:hidden">
            <div className="size-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center p-1.5">
              <BoxcodeLogo className="size-full text-white" />
            </div>
            <span className="font-display text-sm font-bold text-white">Boxcode</span>
          </div>

          <div className="space-y-1">
            <h1 className="font-display text-3xl font-black tracking-tight text-white">
              Sign in to Boxcode
            </h1>
            <p className="text-sm text-white/60 font-body">
              Attendance, leave and approvals for your team.
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled
              className="w-full flex items-center justify-center gap-3 bg-white/5 border border-white/10 rounded-full py-3 px-4 text-xs font-medium text-white/50 cursor-not-allowed opacity-60 backdrop-blur-sm"
            >
              <GoogleIcon className="size-4" />
              <span>Continue with Google</span>
            </button>
            <p className="text-center text-[11px] text-white/40 font-mono">
              Google sign-in is not enabled yet — use your email and password.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-white/40 text-xs uppercase font-mono tracking-wider">or credentials</span>
            <div className="h-px bg-white/10 flex-1" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-mono font-medium text-white/70">
                Email Address
              </label>
              <div className="relative">
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  placeholder="your.email@boxcode.ai"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl bg-white/5 border border-white/10 py-3 ps-10 pe-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                />
                <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                  <AtSignIcon className="size-4" aria-hidden="true" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-mono font-medium text-white/70">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl bg-white/5 border border-white/10 py-3 ps-10 pe-10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                />
                <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                  <LockIcon className="size-4" aria-hidden="true" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 end-0 flex items-center pe-3 text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 font-mono"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-white text-black font-semibold py-3 px-6 hover:bg-white/90 transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-white/10 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {busy ? (
                <span>Signing in...</span>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRightIcon className="size-4" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-[11px] text-white/40 font-mono pt-2">
            By continuing, you agree to Boxcode's{' '}
            <Link href="#" className="underline text-white/50 hover:text-white transition-colors">
              Security Policy
            </Link>{' '}
            and Privacy Terms.
          </p>
        </motion.div>
      </div>
    </main>
  );
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

export default AuthPage;
