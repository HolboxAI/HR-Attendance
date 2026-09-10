'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  LEAVE_STATUS, dateRange, proxy,
  type BalanceRow, type LeaveRequestRow, type LeaveTypeRow,
} from '@/lib/format';

const LEAVE_CATEGORIES = [
  'Personal',
  'Family emergency',
  'Medical/health-related',
  'Family/household responsibility',
  'Other legitimate personal reason',
];

export function MyLeave({
  balances, requests, types,
}: {
  balances: BalanceRow[];
  requests: LeaveRequestRow[];
  types: LeaveTypeRow[];
}) {
  const router = useRouter();
  const [code, setCode] = useState(types[0]?.code ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfStart, setHalfStart] = useState(false);
  const [category, setCategory] = useState<string>('Personal');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedType = types.find(t => t.code === code);
  const requiresProof = selectedType?.requires_proof;

  const [hoveredReqId, setHoveredReqId] = useState<string | null>(null);
  const [hoveredCardCode, setHoveredCardCode] = useState<string | null>(null);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleDocUpload(id: string) {
    if (!uploadFile) return;
    setUploadBusy(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const res = await fetch(proxy(`/api/v1/leave/${id}/document`), {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.detail || 'Upload failed');
      }
      setUploadingId(null);
      setUploadFile(null);
      router.refresh();
    } catch (err: any) {
      setUploadError(err.message || 'Error uploading document');
    } finally {
      setUploadBusy(false);
    }
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (requiresProof && !file) {
      setError('A medical document is required for this leave type.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);

    if (!category) {
      setError('Please select a leave reason category.');
      return;
    }

    const formData = new FormData();
    formData.append('leave_type_code', code);
    formData.append('from_date', from);
    formData.append('to_date', to || from);
    formData.append('half_day_start', String(halfStart));
    formData.append('category', category);
    if (reason) formData.append('reason', reason);
    if (file) formData.append('file', file);

    const res = await fetch(proxy('/api/v1/leave/request'), {
      method: 'POST',
      body: formData,
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? 'Could not submit that request');
      return;
    }
    setFrom(''); setTo(''); setReason(''); setCategory('Personal'); setHalfStart(false); setFile(null);
    setDone(true);
    router.refresh();
  }

  async function cancel(id: string) {
    setBusy(true);
    await fetch(proxy(`/api/v1/leave/${id}/cancel`), { method: 'POST' }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  const field = 'rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ink transition-all';

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Your balance
        </h2>
        <div
          onMouseLeave={() => setHoveredCardCode(null)}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {balances.filter((b) => b.is_paid).map((b) => {
            const isHovered = hoveredCardCode === b.leave_type_id;
            const isDimmed = hoveredCardCode !== null && !isHovered;
            return (
              <div 
                key={b.leave_type_id} 
                onMouseEnter={() => setHoveredCardCode(b.leave_type_id)}
                className={`rounded-2xl glass-panel border border-line p-5 transition-all duration-300 ${isHovered ? 'bg-surface-2/60 scale-[1.02]' : 'hover:bg-surface-2/40'} ${isDimmed ? 'opacity-40 scale-[0.98]' : 'opacity-100'}`}
              >
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                  {b.name}
                </div>
                <div className="tnum mt-2 font-display text-3xl font-black text-ink">
                  {b.available.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                  <span className="text-xs font-normal text-ink-3 font-mono"> left</span>
                </div>
                <div className="tnum mt-2 text-[11px] text-ink-3 font-mono">
                  {b.accrued.toLocaleString('en-IN', { maximumFractionDigits: 1 })} earned ·{' '}
                  {b.used.toLocaleString('en-IN', { maximumFractionDigits: 1 })} taken
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Apply for leave
        </h2>
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3.5 rounded-2xl glass-panel border border-line p-5 sm:p-6">
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">Type</span>
            <select value={code} onChange={(e) => setCode(e.target.value)} className={field}>
              {types.map((t) => (
                <option key={t.id} value={t.code}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">From</span>
            <input type="date" required value={from}
                   onChange={(e) => setFrom(e.target.value)} className={field} />
          </label>
          <label className="space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              To <span className="normal-case tracking-normal text-ink-3/70">(same day if blank)</span>
            </span>
            <input type="date" value={to}
                   onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-2 py-2 text-xs font-medium text-ink-2 cursor-pointer">
            <input type="checkbox" checked={halfStart}
                   onChange={(e) => setHalfStart(e.target.checked)} className="size-4 rounded border-line" />
            Half day
          </label>
          <label className="min-w-[12rem] space-y-1.5">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              Category *
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`${field} w-full`}
            >
              {LEAVE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[14rem] flex-1 space-y-1.5 relative">
            <span className="block text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              Reason {requiresProof && <span className="text-st-absent">* Requires Document</span>}
            </span>
            <div className="relative flex items-center">
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                     placeholder="Brief note on reason..."
                     className={`${field} w-full pr-12`} />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <label className="cursor-pointer p-1.5 rounded-full hover:bg-surface-3 transition-colors text-ink-2 hover:text-ink relative group" aria-label="Attach Document">
                  <input 
                    type="file" 
                    className="sr-only" 
                    accept=".jpg,.jpeg,.png,.pdf" 
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  {file && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-st-approved rounded-full border border-surface"></span>}
                </label>
              </div>
            </div>
            {file && <span className="text-[10px] text-ink-3 block mt-1 line-clamp-1">{file.name}</span>}
          </label>
          <button type="submit" disabled={busy}
                  className="rounded-xl bg-ink text-ground px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all cursor-pointer">
            {busy ? 'Sending…' : 'Apply'}
          </button>

          {error && (
            <p role="alert" className="w-full text-xs text-st-absent font-mono">
              {error}
            </p>
          )}
          {done && (
            <p className="w-full text-xs text-st-present font-mono">
              Sent. It shows as Pending until someone decides.
            </p>
          )}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-3 font-mono">
          Your requests
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-2xl glass-panel border border-line p-5 text-xs text-ink-2 font-mono">
            You haven&apos;t applied for anything yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody onMouseLeave={() => setHoveredReqId(null)}>
                {requests.map((r) => {
                  const s = LEAVE_STATUS[r.status] ?? LEAVE_STATUS.pending;
                  const live = r.status === 'pending' || r.status === 'approved' || r.status === 'partially_approved';
                  const isHovered = hoveredReqId === r.id;
                  const isDimmed = hoveredReqId !== null && !isHovered;
                  const isPartiallyApproved = r.status === 'partially_approved';
                  return (
                    <tr 
                      key={r.id} 
                      onMouseEnter={() => setHoveredReqId(r.id)}
                      className={`border-b border-line/60 last:border-0 transition-all duration-300 ${isHovered ? 'bg-surface-2/60' : 'hover:bg-surface-2/30'} ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {dateRange(r.from_date, r.to_date)}
                      </td>
                      <td className="px-4 py-3 text-ink-2">{r.leave_type_code}</td>
                      <td className="tnum px-4 py-3">{r.days}</td>
                      <td className={`px-4 py-3 ${s.tone} font-semibold`}>
                        <span aria-hidden>{s.glyph} </span>{s.label}
                      </td>
                      <td className="px-4 py-3 text-ink-3">
                        {r.category && (
                          <span className="inline-block px-1.5 py-0.5 mr-2 rounded text-[10px] font-mono font-medium bg-surface-3 text-ink border border-line">
                            {r.category}
                          </span>
                        )}
                        {r.reason && <span className="mr-2 text-ink-2">{r.reason}</span>}
                        {isPartiallyApproved && (
                          <div className="mt-1.5 space-y-1">
                            {r.decided_note && (
                              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-mono text-amber-500">
                                <strong className="uppercase text-[10px] tracking-wider block text-amber-600">Admin Message:</strong>
                                &ldquo;{r.decided_note}&rdquo;
                              </div>
                            )}
                            {r.medical_document_url ? (
                              <div className="flex items-center gap-2 pt-0.5">
                                <a
                                  href={proxy(`/api/v1/leave/${r.id}/document/download`)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-mono font-bold text-emerald-500 hover:underline"
                                >
                                  📎 View Uploaded Medical Document
                                </a>
                                <span className="text-[10px] font-mono text-ink-3">✅ Submitted</span>
                              </div>
                            ) : (
                              <div className="pt-1">
                                {uploadingId === r.id ? (
                                  <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-surface-2 border border-line">
                                    <input
                                      type="file"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                                      className="text-xs font-mono max-w-[220px]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleDocUpload(r.id)}
                                      disabled={!uploadFile || uploadBusy}
                                      className="rounded-lg bg-ink text-ground px-3 py-1 text-xs font-bold disabled:opacity-50 hover:opacity-90"
                                    >
                                      {uploadBusy ? 'Uploading...' : 'Submit Doc'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setUploadingId(null); setUploadFile(null); setUploadError(null); }}
                                      className="text-xs text-ink-3 hover:text-ink font-mono"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-mono text-amber-500 font-semibold">⚠️ Medical certificate required</span>
                                    <button
                                      type="button"
                                      onClick={() => { setUploadingId(r.id); setUploadError(null); }}
                                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 px-2.5 py-1 text-[11px] font-mono font-bold transition-colors cursor-pointer"
                                    >
                                      Upload Document
                                    </button>
                                  </div>
                                )}
                                {uploadError && uploadingId === r.id && (
                                  <p className="text-[11px] text-st-absent font-mono mt-1">{uploadError}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {!isPartiallyApproved && r.decided_note && (
                          <span className="text-ink-3 italic font-mono text-xs">Note: {r.decided_note}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {live && (
                          <button
                            type="button" disabled={busy} onClick={() => cancel(r.id)}
                            className="rounded-xl border border-line glass-panel px-3 py-1.5 text-xs font-mono font-semibold text-ink hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
