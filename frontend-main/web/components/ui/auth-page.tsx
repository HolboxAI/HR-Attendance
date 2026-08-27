'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AtSignIcon, LockIcon } from 'lucide-react';

import { BoxcodeLogo, BoxcodeMark } from './boxcode-logo';
import { Button } from './button';
import HeroText from './hero-shutter-text';
import { Input } from './input';

export function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <main className="relative md:h-screen md:overflow-hidden lg:grid lg:grid-cols-2">
      <div className="relative isolate hidden h-full flex-col border-r border-line bg-muted/60 p-10 lg:flex">
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-background to-transparent" />

        <BoxcodeLogo className="z-10 text-ink" />

        {/* The welcome block: plain lead-in, then the product name under the
            shutter treatment, then the mark. Only the name animates - a
            moving "Welcome to" would pull the eye away from the word that
            actually identifies where you have landed. */}
        <div className="z-10 my-auto flex flex-col items-center gap-6 text-center">
          <p className="text-sm uppercase tracking-[0.4em] text-ink-3">Welcome to</p>
          <HeroText text="HOLBOX" />
          <BoxcodeMark className="size-16 text-ink-2" />
        </div>

        <div className="z-10">
          <blockquote className="space-y-2">
            <p className="text-xl text-ink-2">
              &ldquo;Punch, verify, resolve. Every number on the board can be
              traced back to the evidence behind it.&rdquo;
            </p>
            <footer className="font-mono text-sm font-semibold text-ink-3">
              ~ Boxcode Attendance
            </footer>
          </blockquote>
        </div>

        <div className="absolute inset-0">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      </div>

      <div className="relative flex min-h-screen flex-col justify-center p-4">
        {/*
          One flat gradient layer rather than the three 1280px rounded blobs
          this started as.

          Those blobs sat mostly off-screen under `contain-strict`, which is an
          explicit invitation for the browser to skip painting a subtree - and
          it took the invitation. Reloading blanked whichever half lost the
          race: heading, buttons and inputs gone while the submit button
          survived. Nothing about the glow needs its own compositing layer, so
          now it does not have one.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(60% 50% at 70% 20%, rgba(232,238,241,0.055) 0%, rgba(232,238,241,0.018) 45%, transparent 75%)',
          }}
        />

        <div className="relative z-10 mx-auto space-y-4 sm:w-sm">
          <BoxcodeLogo className="text-ink lg:hidden" />

          <div className="flex flex-col space-y-1">
            <h1 className="font-display text-2xl font-bold tracking-wide">
              Sign in to Boxcode
            </h1>
            <p className="text-base text-muted-foreground">
              Attendance, leave and approvals for your team.
            </p>
          </div>

          <div className="space-y-2">
            {/*
              Disabled, and labelled as such, because the API has no OAuth
              path - /auth/login takes an email and a password and nothing
              else. A button that looked live would produce a dead tap and a
              support question. Enable it the day Google sign-in exists
              server-side, not before.
            */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              disabled
            >
              <GoogleIcon className="me-2 size-4" />
              Continue with Google
            </Button>
            <p className="text-center text-xs text-ink-3">
              Google sign-in is not enabled yet — use your email and password.
            </p>
          </div>

          <AuthSeparator />

          <form onSubmit={submit} className="space-y-2">
            <p className="text-start text-xs text-muted-foreground">
              Sign in with the account HR created for you
            </p>

            <div className="relative h-max">
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="username"
                placeholder="your.email@example.com"
                aria-label="Email"
                className="peer ps-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground peer-disabled:opacity-50">
                <AtSignIcon className="size-4" aria-hidden="true" />
              </div>
            </div>

            <div className="relative h-max">
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Your password"
                aria-label="Password"
                className="peer ps-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground peer-disabled:opacity-50">
                <LockIcon className="size-4" aria-hidden="true" />
              </div>
            </div>

            {/* Never colour alone - the glyph and the sentence carry it too. */}
            {error && (
              <p role="alert" className="text-sm text-st-absent">
                <span aria-hidden>○ </span>
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              <span>{busy ? 'Signing in…' : 'Sign in'}</span>
            </Button>
          </form>

          <p className="mt-8 text-sm text-muted-foreground">
            There is no self-service signup — HR creates your account, and the
            same credentials work in the Boxcode app on your phone.
          </p>
        </div>
      </div>
    </main>
  );
}

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 10 * position} -${189 + i * 12}C-${
      380 - i * 10 * position
    } -${189 + i * 12} -${312 - i * 10 * position} ${216 - i * 12} ${
      152 - i * 10 * position
    } ${343 - i * 12}C${616 - i * 10 * position} ${470 - i * 12} ${
      684 - i * 10 * position
    } ${875 - i * 12} ${684 - i * 10 * position} ${875 - i * 12}`,
    width: 0.5 + i * 0.06,
  }));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/*
        The paths themselves are static and the whole field drifts as one
        layer. Previously each path animated its own `pathLength`, which is a
        stroke-dashoffset under the hood and therefore re-rasterises the entire
        SVG every frame - 36 of those, forever, was what tore the panel apart
        after ten seconds. See the bx-paths comment in globals.css.
      */}
      <svg
        className="bx-paths h-full w-full text-slate-950 dark:text-white"
        viewBox="0 0 696 316"
        fill="none"
        aria-hidden
      >
        {paths.map((path) => (
          <path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={0.1 + path.id * 0.045}
          />
        ))}
      </svg>
    </div>
  );
}

const GoogleIcon = (props: React.ComponentProps<'svg'>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <g>
      <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669   C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62   c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401   c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
    </g>
  </svg>
);

const AuthSeparator = () => {
  return (
    <div className="flex w-full items-center justify-center">
      <div className="h-px w-full bg-border" />
      <span className="px-2 text-xs text-muted-foreground">OR</span>
      <div className="h-px w-full bg-border" />
    </div>
  );
};
