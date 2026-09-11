'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Home,
  Laptop,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { proxy } from '@/lib/format';

type WFHRequest = {
  id: string;
  shift_date: string;
  reason: string;
  status: string;
  created_at: string;
};

export default function WFHPage() {
  const [requests, setRequests] = useState<WFHRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [shiftDate, setShiftDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(proxy('/api/v1/wfh'));
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      } else {
        const err = await res.json().catch(() => null);
        setError(err?.detail || 'Failed to load your WFH history.');
      }
    } catch {
      setError('Could not connect to the server to load WFH history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormFeedback(null);

    if (!shiftDate) {
      setFormFeedback({ type: 'error', message: 'Please select a date for your WFH request.' });
      return;
    }
    if (!reason.trim()) {
      setFormFeedback({ type: 'error', message: 'Please provide a reason for working from home.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(proxy('/api/v1/wfh/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shift_date: shiftDate,
          reason: reason.trim(),
        }),
      });

      const body = await res.json().catch(() => null);

      if (res.ok) {
        setFormFeedback({
          type: 'success',
          message: 'Your WFH request has been submitted successfully for HR review!',
        });
        setReason('');
        await loadRequests();
      } else {
        setFormFeedback({
          type: 'error',
          message: body?.detail || `Failed to submit request (${res.status}).`,
        });
      }
    } catch {
      setFormFeedback({
        type: 'error',
        message: 'Network error. Please check your connection and try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Stats calculation
  const totalCount = requests.length;
  const approvedCount = requests.filter((r) => r.status.toLowerCase() === 'approved').length;
  const pendingCount = requests.filter((r) => r.status.toLowerCase() === 'pending').length;
  const rejectedCount = requests.filter((r) => r.status.toLowerCase() === 'rejected').length;

  return (
    <div className="max-w-5xl mx-auto space-y-8 fade-in-up py-4">
      {/* Top Breadcrumb & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Laptop className="size-3.5" />
            <span>Attendance · Remote Operations</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-ink">
            Work From Home (WFH)
          </h1>
          <p className="text-xs sm:text-sm text-ink-3">
            Apply for remote working permissions. When approved, office geofence checks are automatically bypassed for mobile check-in.
          </p>
        </div>

        <Link
          href="/checkin"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 border border-line text-ink text-xs font-mono font-bold hover:bg-surface-3 transition-colors shrink-0"
        >
          <Clock className="size-4 text-blue-500" />
          <span>Go to Check-in</span>
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-line/70">
          <div className="text-[11px] font-mono text-ink-3 uppercase tracking-wider">Total Requests</div>
          <div className="font-display text-3xl font-extrabold text-ink mt-1">{totalCount}</div>
          <div className="text-[11px] text-ink-3 font-mono mt-1">All time applications</div>
        </div>

        <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-emerald-500/30 bg-emerald-500/5">
          <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Approved</div>
          <div className="font-display text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">{approvedCount}</div>
          <div className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70 font-mono mt-1">Remote days granted</div>
        </div>

        <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-amber-500/30 bg-amber-500/5">
          <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400 uppercase tracking-wider">Pending Review</div>
          <div className="font-display text-3xl font-extrabold text-amber-600 dark:text-amber-400 mt-1">{pendingCount}</div>
          <div className="text-[11px] text-amber-700/70 dark:text-amber-300/70 font-mono mt-1">Awaiting decision</div>
        </div>

        <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-rose-500/30 bg-rose-500/5">
          <div className="text-[11px] font-mono text-rose-600 dark:text-rose-400 uppercase tracking-wider">Rejected</div>
          <div className="font-display text-3xl font-extrabold text-rose-600 dark:text-rose-400 mt-1">{rejectedCount}</div>
          <div className="text-[11px] text-rose-700/70 dark:text-rose-300/70 font-mono mt-1">Not approved</div>
        </div>
      </div>

      {/* Main Grid: Form on left, History on right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: WFH Application Form */}
        <div className="lg:col-span-5">
          <div className="glass-panel rounded-3xl border border-line p-6 sm:p-8 space-y-5 bg-gradient-to-b from-surface via-surface to-surface-2/20 shadow-sm">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                <Plus className="size-3.5" />
                <span>NEW APPLICATION</span>
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-black text-ink">
                Apply for Remote Work
              </h2>
              <p className="text-xs text-ink-3">
                Specify your shift date and a clear reason for working from home.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Shift Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono font-semibold uppercase tracking-wider text-ink-2">
                  Shift Date <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={shiftDate}
                    onChange={(e) => setShiftDate(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-surface border border-line text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono font-semibold uppercase tracking-wider text-ink-2 flex justify-between">
                  <span>Reason for WFH <span className="text-rose-500">*</span></span>
                  <span className="text-[10px] text-ink-3 font-normal">{reason.length}/500</span>
                </label>
                <textarea
                  required
                  rows={4}
                  maxLength={500}
                  placeholder="e.g., Attending personal family matters at home, or home renovation work in progress."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-surface border border-line text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none leading-relaxed"
                />
              </div>

              {/* Policy note */}
              <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20 flex items-start gap-2.5 text-xs text-ink-2">
                <ShieldCheck className="size-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-ink-3">
                  Once approved by your manager, you can check in and check out from home on your mobile app without triggering geofence distance violations.
                </p>
              </div>

              {/* Form Feedback Alert */}
              {formFeedback && (
                <div
                  className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs font-semibold ${
                    formFeedback.type === 'success'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {formFeedback.type === 'success' ? (
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="size-4 text-rose-500 shrink-0" />
                  )}
                  <span>{formFeedback.message}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-display font-bold text-sm tracking-wide shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Submitting Request…</span>
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    <span>Submit WFH Request</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: WFH History */}
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel rounded-3xl border border-line p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-ink">Request History</h2>
                <p className="text-xs text-ink-3">Your previous and current remote work requests</p>
              </div>
              <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-surface-2 border border-line text-ink-3">
                {requests.length} records
              </span>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-ink-3 text-xs font-mono">
                <Loader2 className="size-6 animate-spin text-blue-500" />
                <span>Loading your WFH records…</span>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-mono flex items-center gap-2">
                <AlertCircle className="size-4" />
                <span>{error}</span>
              </div>
            ) : requests.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="size-12 rounded-2xl bg-surface-2 border border-line flex items-center justify-center mx-auto text-ink-3">
                  <Home className="size-6" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-sm text-ink">No WFH requests yet</p>
                  <p className="text-xs text-ink-3 max-w-sm mx-auto">
                    When you apply for remote work, your applications and review status will appear right here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-line/60">
                {requests.map((r) => {
                  const statusLower = r.status.toLowerCase();
                  const isApproved = statusLower === 'approved';
                  const isPending = statusLower === 'pending';
                  const isRejected = statusLower === 'rejected';

                  const badgeClass = isApproved
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : isPending
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30';

                  const StatusIcon = isApproved ? CheckCircle2 : isPending ? Clock : XCircle;

                  return (
                    <div key={r.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-display font-extrabold text-base text-ink">
                            {new Date(`${r.shift_date}T00:00:00Z`).toLocaleDateString('en-IN', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              timeZone: 'UTC',
                            })}
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider border ${badgeClass}`}>
                            <StatusIcon className="size-3" />
                            <span>{r.status}</span>
                          </span>
                        </div>

                        <p className="text-xs text-ink-2 italic leading-relaxed">
                          &ldquo;{r.reason}&rdquo;
                        </p>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <div className="text-[11px] text-ink-4 font-mono">
                          Applied {new Date(r.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
