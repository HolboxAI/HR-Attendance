'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AtSignIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowRightIcon,
  UserIcon,
  PhoneIcon,
  BriefcaseIcon,
  CheckCircle2,
  ShieldCheck,
  Building2,
  ArrowLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { BoxcodeLogo, HolboxMark } from './boxcode-logo';
import HeroText from './hero-shutter-text';
import { SpotlightCursor } from './spotlight-cursor';
import { CanvasRevealEffect } from './sign-in-flow-1';
import { SparklesCore } from './sparkles';

export function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          phone: phone.trim() || null,
          desired_department: department.trim() || null,
          desired_designation: designation.trim() || null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Registration submission failed');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full bg-black text-white overflow-hidden lg:grid lg:grid-cols-2">
      <SpotlightCursor config={{ radius: 120 }} />

      {/* Global Background Dot Matrix Canvas Animation */}
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
            <span className="font-display text-sm font-bold tracking-tight text-white">Holbox</span>
            <span className="text-[10px] text-white/50 font-mono">Workforce Portal</span>
          </div>
        </div>

        <div className="my-auto flex flex-col items-center gap-6 text-center">
          <HeroText
            text="JOIN THE TEAM"
            size="text-[clamp(1.1rem,2vw,1.6rem)]"
            className="gap-[0.3em] opacity-90"
          />
          <HeroText text="HOLBOX" />

          <div className="pointer-events-none relative -mt-4 h-40 w-full max-w-[34rem]">
            <div className="absolute inset-x-20 top-0 h-[2px] w-3/4 bg-gradient-to-r from-transparent via-emerald-500 to-transparent blur-sm" />
            <div className="absolute inset-x-20 top-0 h-px w-3/4 bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />
            <div className="absolute inset-x-60 top-0 h-[5px] w-1/4 bg-gradient-to-r from-transparent via-teal-400 to-transparent blur-sm" />
            <div className="absolute inset-x-60 top-0 h-px w-1/4 bg-gradient-to-r from-transparent via-teal-400 to-transparent" />

            <SparklesCore
              background="transparent"
              minSize={0.4}
              maxSize={1}
              particleDensity={1200}
              className="h-full w-full"
              particleColor="#FFFFFF"
            />
            <div className="absolute inset-0 h-full w-full bg-black [mask-image:radial-gradient(350px_200px_at_top,transparent_20%,white)]" />
          </div>

          <HolboxMark className="size-16 -mt-6" />
        </div>
      </div>

      {/* Right Registration Form / Confirmation Column */}
      <div className="relative flex min-h-screen flex-col justify-center items-center p-6 z-10">
        <motion.div
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md space-y-6 rounded-3xl glass-panel p-8 sm:p-10 border border-white/10 bg-black/40 backdrop-blur-2xl shadow-2xl"
        >
          <div className="flex items-center gap-3 lg:hidden">
            <div className="size-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center p-1.5">
              <BoxcodeLogo className="size-full text-white" />
            </div>
            <span className="font-display text-sm font-bold text-white">Holbox</span>
          </div>

          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div
                key="submitted-state"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6 text-center py-4"
              >
                <div className="mx-auto size-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/10">
                  <ShieldCheck className="size-9" />
                </div>

                <div className="space-y-2">
                  <h2 className="font-display text-2xl font-bold tracking-tight text-white">
                    Request Sent to Admin
                  </h2>
                  <p className="text-sm text-white/70 leading-relaxed font-body">
                    Your registration request for <strong className="text-white">{email}</strong> has been submitted to the Holbox HR Admin team.
                  </p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left space-y-2 text-xs text-white/60">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Admin has been notified on Slack & in-app to approve and assign your employee code.</span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>Once approved, sign in with your email and password to upload your face biometric photo.</span>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href="/login"
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white text-black font-semibold py-3 px-6 hover:bg-white/90 transition-all active:scale-98 shadow-lg shadow-white/10"
                  >
                    <ArrowLeft className="size-4" />
                    <span>Back to Sign in</span>
                  </Link>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="form-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="space-y-1">
                  <h1 className="font-display text-3xl font-black tracking-tight text-white">
                    Request to Join
                  </h1>
                  <p className="text-sm text-white/60 font-body">
                    Create your profile. Admin will review and approve your account.
                  </p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                  {/* Full Name */}
                  <div className="space-y-1.5">
                    <label htmlFor="fullName" className="text-xs font-mono font-medium text-white/70">
                      Full Name *
                    </label>
                    <div className="relative">
                      <input
                        id="fullName"
                        name="fullName"
                        type="text"
                        required
                        autoFocus
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 ps-10 pe-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                      />
                      <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                        <UserIcon className="size-4" aria-hidden="true" />
                      </div>
                    </div>
                  </div>

                  {/* Work Email */}
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="text-xs font-mono font-medium text-white/70">
                      Work Email *
                    </label>
                    <div className="relative">
                      <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        placeholder="name@holbox.ai"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 ps-10 pe-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                      />
                      <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                        <AtSignIcon className="size-4" aria-hidden="true" />
                      </div>
                    </div>
                  </div>

                  {/* Password */}
                  <div className="space-y-1.5">
                    <label htmlFor="password" className="text-xs font-mono font-medium text-white/70">
                      Desired Password * (min. 8 characters)
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 ps-10 pe-10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
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

                  {/* Phone Number */}
                  <div className="space-y-1.5">
                    <label htmlFor="phone" className="text-xs font-mono font-medium text-white/70">
                      Phone Number (optional)
                    </label>
                    <div className="relative">
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 ps-10 pe-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                      />
                      <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                        <PhoneIcon className="size-4" aria-hidden="true" />
                      </div>
                    </div>
                  </div>

                  {/* Department & Designation in two columns */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="department" className="text-xs font-mono font-medium text-white/70">
                        Department
                      </label>
                      <div className="relative">
                        <input
                          id="department"
                          name="department"
                          type="text"
                          placeholder="e.g. Engineering"
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                          className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 ps-9 pe-3 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                        />
                        <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                          <Building2 className="size-3.5" aria-hidden="true" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="designation" className="text-xs font-mono font-medium text-white/70">
                        Designation
                      </label>
                      <div className="relative">
                        <input
                          id="designation"
                          name="designation"
                          type="text"
                          placeholder="e.g. AI Researcher"
                          value={designation}
                          onChange={(e) => setDesignation(e.target.value)}
                          className="w-full rounded-2xl bg-white/5 border border-white/10 py-2.5 ps-9 pe-3 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all font-body"
                        />
                        <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-white/40">
                          <BriefcaseIcon className="size-3.5" aria-hidden="true" />
                        </div>
                      </div>
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
                    className="w-full rounded-full bg-white text-black font-semibold py-3 px-6 hover:bg-white/90 transition-all active:scale-98 cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-white/10 disabled:opacity-50 disabled:cursor-not-allowed mt-3"
                  >
                    {busy ? (
                      <span>Submitting Request...</span>
                    ) : (
                      <>
                        <span>Submit Registration</span>
                        <ArrowRightIcon className="size-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-2 text-center text-xs text-white/60">
                  Already have an account?{' '}
                  <Link href="/login" className="font-semibold text-white hover:underline transition-colors">
                    Sign in here
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </main>
  );
}

export default SignupPage;
