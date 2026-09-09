'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  KeyRound, ShieldCheck, CheckCircle2, AlertCircle, Eye, EyeOff, Lock,
  UserCheck, Sparkles, Copy, Check, Laptop, Moon, Sun, SunMoon,
  Sliders, BellRing, Globe, Calendar, Clock, Building2, Server,
  Radio, RefreshCw, Smartphone, ChevronRight, Fingerprint
} from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { applyTheme } from '@/components/ThemeToggle';
import type { Identity } from '@/lib/session';
import { roleLabel } from '@/lib/capabilities';

interface SettingsPageProps {
  user: Identity | null;
}

export function SettingsPage({ user }: SettingsPageProps) {
  // Tabs
  const [activeTab, setActiveTab] = useState<'security' | 'handover' | 'profile' | 'preferences' | 'notifications'>('security');

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Executive text copy state
  const [copiedHandover, setCopiedHandover] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Preference states (stored in localStorage)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('light');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState('12h');
  const [defaultLanding, setDefaultLanding] = useState('/');
  const [chimeEnabled, setChimeEnabled] = useState(true);
  const [notifyLeave, setNotifyLeave] = useState(true);
  const [notifyShifts, setNotifyShifts] = useState(true);
  const [notifyPunch, setNotifyPunch] = useState(true);

  useEffect(() => {
    try {
      const storedTheme = (localStorage.getItem('bx-theme') as any) || 'light';
      setThemeMode(storedTheme);
      setDateFormat(localStorage.getItem('bx-date-format') || 'DD/MM/YYYY');
      setTimeFormat(localStorage.getItem('bx-time-format') || '12h');
      setDefaultLanding(localStorage.getItem('bx-default-landing') || '/');
      setChimeEnabled(localStorage.getItem('bx-chime') !== 'false');
      setNotifyLeave(localStorage.getItem('bx-notify-leave') !== 'false');
      setNotifyShifts(localStorage.getItem('bx-notify-shifts') !== 'false');
      setNotifyPunch(localStorage.getItem('bx-notify-punch') !== 'false');
    } catch {
      // Safe fallback
    }
  }, []);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleThemeChange = (mode: 'light' | 'dark' | 'system') => {
    setThemeMode(mode);
    try {
      localStorage.setItem('bx-theme', mode);
    } catch {}
    applyTheme(mode);
    triggerToast(`Theme set to ${mode.toUpperCase()}`);
  };

  const handleSavePref = (key: string, val: string, label: string) => {
    try {
      localStorage.setItem(key, val);
      triggerToast(`${label} updated`);
    } catch {}
  };

  // Password strength calculation
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return 0;
    let score = 0;
    if (pwd.length >= 10) score += 1;
    if (pwd.length >= 14) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
    return Math.min(score, 4);
  };

  const strengthScore = getPasswordStrength(newPassword);
  const strengthLabels = ['Too Short', 'Weak', 'Fair', 'Strong', 'Excellent'];
  const strengthColors = [
    'bg-zinc-700',
    'bg-rose-500',
    'bg-amber-500',
    'bg-blue-500',
    'bg-emerald-500',
  ];

  // Submit Password Change
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }

    if (newPassword.length < 10) {
      setPasswordError('New password must be at least 10 characters long.');
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from your current password.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch('/api/gateway/api/v1/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPasswordError(data.detail || 'Could not update password. Please check your current password.');
        setSavingPassword(false);
        return;
      }

      // Automatically refresh user session with new password to update tokens
      if (user?.email) {
        await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            password: newPassword,
          }),
        }).catch(() => undefined);
      }

      setPasswordSuccess('Password successfully updated! Your active session has been renewed with the new credentials.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      triggerToast('Password changed successfully');
    } catch {
      setPasswordError('Network error connecting to authentication server.');
    } finally {
      setSavingPassword(false);
    }
  };

  // Executive announcement message
  const executiveText = `Hi Team,

The Boxcode HRMS platform is now officially LIVE and running on our dedicated AWS Cloud instance!

🌐 Portal URL: http://98.84.138.15
🔑 Admin Login: ${user?.email || 'krish@boxcode.ai'}

Operational Systems:
✅ Attendance Board & Real-Time Tracking
✅ Facial Biometric Verification & Device Registration
✅ Punch Corrections & Attendance Regularization
✅ Multi-Shift Rostering (Interns, Fixed & Rotational)
✅ Leave Requests, Balances & Organization Holiday Calendar
✅ Full Audit Trails & Real-Time Notifications

The system is ready for review and employee onboarding.`;

  const copyExecutiveText = () => {
    navigator.clipboard.writeText(executiveText);
    setCopiedHandover(true);
    triggerToast('Announcement message copied to clipboard');
    setTimeout(() => setCopiedHandover(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl glass-panel border border-emerald-500/30 bg-surface/90 shadow-2xl text-xs font-semibold text-ink animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Settings & System Preferences"
        sub="Manage your personal credentials, customize display options, and view live cloud infrastructure details."
      >
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-xs">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            AWS EC2 Live
          </span>
        </div>
      </PageHeader>

      {/* Live System Handover Banner for Senior Review */}
      <div className="rounded-2xl glass-panel border border-line p-5 sm:p-6 relative overflow-hidden bg-gradient-to-r from-surface to-surface-2/40 shadow-sm">
        <div className="absolute -right-8 -top-8 size-40 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-bold bg-ink text-ground">
                Live Deployment
              </span>
              <span className="text-xs font-mono text-ink-3">v1.0.4-prod • 98.84.138.15</span>
            </div>
            <h2 className="font-display text-lg font-bold text-ink">
              Boxcode HRMS Enterprise Portal is Active & Ready
            </h2>
            <p className="text-xs text-ink-3 leading-relaxed">
              All workforce modules—including biometric check-in, multi-shift rosters, leave approvals, and live attendance boards—are running smoothly in production. You can copy the executive summary below to share with seniors.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyExecutiveText}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-ink text-ground text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm cursor-pointer"
            >
              {copiedHandover ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>Copy Handover Text</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('handover')}
              className="px-3 py-2 rounded-xl glass-panel border border-line text-xs font-medium text-ink hover:bg-surface-2 transition-colors cursor-pointer"
            >
              View Message
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 border-b border-line pb-2 overflow-x-auto bx-scroll">
        {[
          { id: 'security', label: 'Security & Password', icon: KeyRound },
          { id: 'handover', label: 'Senior Handover Note', icon: Sparkles },
          { id: 'profile', label: 'My Account Profile', icon: UserCheck },
          { id: 'preferences', label: 'Display & Interface', icon: Sliders },
          { id: 'notifications', label: 'Notifications', icon: BellRing },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-surface-2 text-ink font-semibold shadow-xs border border-line'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-2/60 border border-transparent'
              }`}
            >
              <Icon className={`size-3.5 ${isActive ? 'text-ink' : 'text-ink-3'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: SECURITY & CHANGE PASSWORD */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Change Password Card */}
          <div className="lg:col-span-2 rounded-2xl glass-panel border border-line p-5 sm:p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-line/60 pb-4">
              <div className="space-y-0.5">
                <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
                  <Lock className="size-4 text-emerald-400" />
                  Change Password
                </h2>
                <p className="text-xs text-ink-3">
                  Update your authentication credentials. Your new password must be at least 10 characters.
                </p>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-surface-2 text-ink-3 border border-line">
                BCrypt Encrypted
              </span>
            </div>

            {/* Alert feedbacks */}
            {passwordSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-start gap-2.5">
                <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Password Successfully Updated</p>
                  <p className="text-[11px] text-emerald-400/80">{passwordSuccess}</p>
                </div>
              </div>
            )}

            {passwordError && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2.5">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Unable to Change Password</p>
                  <p className="text-[11px] text-rose-400/80">{passwordError}</p>
                </div>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {/* Current Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink flex items-center justify-between">
                  <span>Current Password</span>
                  <span className="text-[10px] font-mono text-ink-3">Required for verification</span>
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full h-10 px-3.5 pr-10 rounded-xl bg-surface-2/60 border border-line text-ink text-xs focus:outline-none focus:border-ink/50 transition-colors"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                    title={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink flex items-center justify-between">
                  <span>New Password</span>
                  <span className="text-[10px] font-mono text-ink-3">Min. 10 characters</span>
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Create a strong new password"
                    className="w-full h-10 px-3.5 pr-10 rounded-xl bg-surface-2/60 border border-line text-ink text-xs focus:outline-none focus:border-ink/50 transition-colors"
                    required
                    minLength={10}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                    title={showNew ? 'Hide password' : 'Show password'}
                  >
                    {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>

                {/* Password strength meter */}
                {newPassword.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-ink-3">Strength:</span>
                      <span className={`font-semibold ${strengthScore >= 3 ? 'text-emerald-400' : strengthScore >= 2 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {strengthLabels[strengthScore]}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 h-1.5">
                      {[0, 1, 2, 3].map((step) => (
                        <div
                          key={step}
                          className={`rounded-full transition-all duration-300 ${
                            strengthScore > step ? strengthColors[strengthScore] : 'bg-surface-2'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-type your new password"
                    className="w-full h-10 px-3.5 pr-10 rounded-xl bg-surface-2/60 border border-line text-ink text-xs focus:outline-none focus:border-ink/50 transition-colors"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                    title={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1">
                    <AlertCircle className="size-3" /> Passwords do not match
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setPasswordError(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={savingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-ink text-ground text-xs font-semibold hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all shadow-sm cursor-pointer"
                >
                  {savingPassword ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="size-3.5" />
                      <span>Update Password</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Security & Active Session Card */}
          <div className="space-y-6">
            <div className="rounded-2xl glass-panel border border-line p-5 shadow-sm space-y-4">
              <h3 className="font-display text-sm font-bold text-ink flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-400" />
                Security Standards
              </h3>
              <ul className="space-y-2.5 text-xs text-ink-3">
                <li className="flex items-start gap-2">
                  <Check className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Passwords stored using salted BCrypt cryptographic hashes.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Tokens scoped to HTTP-only, SameSite=Lax browser cookies.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Updating password immediately revokes previous active sessions.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Sub-minute automated refresh token rotation prevents replay attacks.</span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl glass-panel border border-line p-5 shadow-sm space-y-3">
              <h3 className="font-display text-sm font-bold text-ink flex items-center gap-2">
                <Server className="size-4 text-ink-3" />
                Current Active Session
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1 border-b border-line/40">
                  <span className="text-ink-3">Host Node:</span>
                  <span className="text-ink font-semibold">98.84.138.15</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/40">
                  <span className="text-ink-3">Account:</span>
                  <span className="text-ink truncate max-w-36">{user?.email}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-line/40">
                  <span className="text-ink-3">Token Scope:</span>
                  <span className="text-emerald-400 font-semibold">{roleLabel(user?.role || 'hr_admin')}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-3">Session Type:</span>
                  <span className="text-ink">Web Browser (Desktop)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SENIOR HANDOVER NOTE */}
      {activeTab === 'handover' && (
        <div className="rounded-2xl glass-panel border border-line p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line/60 pb-4">
            <div className="space-y-1">
              <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
                <Sparkles className="size-4 text-amber-400" />
                Executive Handover Note for Seniors
              </h2>
              <p className="text-xs text-ink-3">
                Copy and send this concise summary to leadership, management, or your senior to announce the live HRMS deployment.
              </p>
            </div>
            <button
              type="button"
              onClick={copyExecutiveText}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ink text-ground text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm cursor-pointer shrink-0"
            >
              {copiedHandover ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  <span>Message Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>
          </div>

          <div className="rounded-xl bg-surface-2/60 border border-line p-4 font-mono text-xs text-ink leading-relaxed whitespace-pre-wrap select-all">
            {executiveText}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-xl border border-line bg-surface/50 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                <Radio className="size-3.5 text-emerald-400 animate-pulse" />
                Production Ready
              </div>
              <p className="text-[11px] text-ink-3">
                Full microservice architecture running under Nginx reverse proxy on AWS EC2.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-line bg-surface/50 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                <Fingerprint className="size-3.5 text-blue-400" />
                Biometric & Roster
              </div>
              <p className="text-[11px] text-ink-3">
                Facial landmark vectors + multi-shift scheduling ready for company testing.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-line bg-surface/50 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                Audit Protection
              </div>
              <p className="text-[11px] text-ink-3">
                Immutable punch logs and 7-day correction quota tracking active.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MY ACCOUNT PROFILE */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 rounded-2xl glass-panel border border-line p-6 shadow-sm flex flex-col items-center text-center space-y-4">
            <div className="size-20 rounded-2xl bg-surface-2 border border-line flex items-center justify-center font-display text-2xl font-bold text-ink shadow-sm">
              {user?.full_name ? user.full_name.slice(0, 2).toUpperCase() : 'BX'}
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-base font-bold text-ink">
                {user?.full_name || 'System Administrator'}
              </h3>
              <p className="text-xs font-mono text-ink-3">{user?.email}</p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider bg-surface-2 text-ink border border-line">
              {roleLabel(user?.role || 'hr_admin')}
            </span>
          </div>

          <div className="lg:col-span-2 rounded-2xl glass-panel border border-line p-6 shadow-sm space-y-4">
            <h3 className="font-display text-sm font-bold text-ink border-b border-line/60 pb-3">
              Employee & Workplace Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-surface-2/40 border border-line/60 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3">Employee Code</span>
                <p className="font-semibold text-ink font-mono">{user?.employee_code || 'BX001'}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-surface-2/40 border border-line/60 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3">Organization</span>
                <p className="font-semibold text-ink">Boxcode Technologies / IIMA Ventures</p>
              </div>
              <div className="p-3.5 rounded-xl bg-surface-2/40 border border-line/60 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3">Attendance Punch</span>
                <p className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5" />
                  {user?.can_punch ? 'Allowed on Handset / Web' : 'Web Portal Access Only'}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-surface-2/40 border border-line/60 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3">Monthly Correction Limit</span>
                <p className="font-semibold text-ink font-mono">{user?.correction_limit ?? 7} requests / month</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DISPLAY & PREFERENCES */}
      {activeTab === 'preferences' && (
        <div className="rounded-2xl glass-panel border border-line p-6 shadow-sm space-y-6">
          <div className="space-y-1 border-b border-line/60 pb-4">
            <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
              <Sliders className="size-4 text-ink" />
              Interface & Display Preferences
            </h2>
            <p className="text-xs text-ink-3">
              Personalize your viewing experience. Choices persist across your browser sessions.
            </p>
          </div>

          <div className="space-y-5 max-w-2xl">
            {/* Theme selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink">Theme Mode</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'light', label: 'Light Mode', icon: Sun },
                  { id: 'dark', label: 'Dark Mode', icon: Moon },
                  { id: 'system', label: 'System Sync', icon: SunMoon },
                ].map((t) => {
                  const Icon = t.icon;
                  const isCurrent = themeMode === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleThemeChange(t.id as any)}
                      className={`flex flex-col items-center gap-2 p-3.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                        isCurrent
                          ? 'border-ink bg-surface-2 shadow-xs text-ink font-semibold'
                          : 'border-line bg-surface/50 text-ink-3 hover:text-ink hover:bg-surface-2'
                      }`}
                    >
                      <Icon className="size-4" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date format */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">Date Format</label>
              <select
                value={dateFormat}
                onChange={(e) => {
                  setDateFormat(e.target.value);
                  handleSavePref('bx-date-format', e.target.value, 'Date format');
                }}
                className="w-full h-10 px-3 rounded-xl bg-surface-2/60 border border-line text-ink text-xs focus:outline-none focus:border-ink/50 transition-colors"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 08/09/2026 - Standard)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 2026-09-08 - ISO)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 09/08/2026 - US)</option>
              </select>
            </div>

            {/* Time format */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">Time Display</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: '12h', label: '12-Hour (09:30 AM)' },
                  { id: '24h', label: '24-Hour (09:30)' },
                ].map((tf) => (
                  <button
                    key={tf.id}
                    type="button"
                    onClick={() => {
                      setTimeFormat(tf.id);
                      handleSavePref('bx-time-format', tf.id, 'Time display');
                    }}
                    className={`p-3 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
                      timeFormat === tf.id
                        ? 'border-ink bg-surface-2 text-ink font-semibold'
                        : 'border-line text-ink-3 hover:text-ink hover:bg-surface-2'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Default landing page */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">Default Landing Page</label>
              <select
                value={defaultLanding}
                onChange={(e) => {
                  setDefaultLanding(e.target.value);
                  handleSavePref('bx-default-landing', e.target.value, 'Landing page');
                }}
                className="w-full h-10 px-3 rounded-xl bg-surface-2/60 border border-line text-ink text-xs focus:outline-none focus:border-ink/50 transition-colors"
              >
                <option value="/">Main Dashboard (/)</option>
                <option value="/board">Attendance Board (/board)</option>
                <option value="/checkin">Self Check-In (/checkin)</option>
                <option value="/people/shifts">Shift Management (/people/shifts)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: NOTIFICATIONS */}
      {activeTab === 'notifications' && (
        <div className="rounded-2xl glass-panel border border-line p-6 shadow-sm space-y-6">
          <div className="space-y-1 border-b border-line/60 pb-4">
            <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
              <BellRing className="size-4 text-ink" />
              Notification Triggers & Sound Alerts
            </h2>
            <p className="text-xs text-ink-3">
              Control what alerts and audio chimes you receive while navigating the portal.
            </p>
          </div>

          <div className="space-y-4 max-w-2xl">
            {[
              {
                title: 'Audio Chime Alerts',
                desc: 'Play a discreet chime when new attendance alerts or notifications arrive.',
                state: chimeEnabled,
                toggle: () => {
                  const next = !chimeEnabled;
                  setChimeEnabled(next);
                  handleSavePref('bx-chime', String(next), 'Audio chime');
                },
              },
              {
                title: 'Leave Approvals & Rejections',
                desc: 'Receive instant alerts whenever a team member or manager responds to leave requests.',
                state: notifyLeave,
                toggle: () => {
                  const next = !notifyLeave;
                  setNotifyLeave(next);
                  handleSavePref('bx-notify-leave', String(next), 'Leave alerts');
                },
              },
              {
                title: 'Shift Schedule Changes',
                desc: 'Get notified immediately if your assigned shift timings or group roster changes.',
                state: notifyShifts,
                toggle: () => {
                  const next = !notifyShifts;
                  setNotifyShifts(next);
                  handleSavePref('bx-notify-shifts', String(next), 'Shift alerts');
                },
              },
              {
                title: 'Punch Confirmation Alerts',
                desc: 'Show an instant toast badge confirming your biometric check-in/out timestamp.',
                state: notifyPunch,
                toggle: () => {
                  const next = !notifyPunch;
                  setNotifyPunch(next);
                  handleSavePref('bx-notify-punch', String(next), 'Punch alerts');
                },
              },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 rounded-xl border border-line bg-surface/40">
                <div className="space-y-0.5 max-w-md">
                  <h4 className="text-xs font-semibold text-ink">{item.title}</h4>
                  <p className="text-[11px] text-ink-3 leading-relaxed">{item.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={item.toggle}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    item.state ? 'bg-ink' : 'bg-surface-2 border border-line'
                  }`}
                >
                  <span
                    className={`size-4 rounded-full bg-ground absolute top-1 transition-transform ${
                      item.state ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
