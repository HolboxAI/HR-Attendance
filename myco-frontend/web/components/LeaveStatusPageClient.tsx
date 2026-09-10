'use client';

import { useState } from 'react';
import { dateRange, proxy, type LeaveRequestRow } from '@/lib/format';
import { useRouter } from 'next/navigation';

export function LeaveStatusPageClient({ rows, isHr }: { rows: LeaveRequestRow[]; isHr: boolean }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [docUploadId, setDocUploadId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<{ id: string; message: string } | null>(null);

  const filtered = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  async function handleUpload(id: string) {
    if (!uploadFile) return;
    setUploading(true);
    setError(null);
    
    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const res = await fetch(proxy(`/api/v1/leave/${id}/document`), {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || 'Upload failed');
      }
      setDocUploadId(null);
      setUploadFile(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Error uploading document');
    } finally {
      setUploading(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    setDecidingId(id);
    setDecideError(null);
    const res = await fetch(proxy(`/api/v1/admin/leave/${id}/decide`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve, note: null }),
    }).catch(() => null);
    setDecidingId(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setDecideError({ id, message: body?.detail ?? 'Could not record that decision' });
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6 fade-in-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight text-ink mt-1">
            Leave Status
          </h1>
          <p className="mt-1 max-w-prose text-xs sm:text-sm text-ink-3 font-mono">
            View and manage all employee leave requests.
          </p>
        </div>
      </div>

      <div className="flex gap-4 items-center mb-6">
        <label className="text-sm font-mono text-ink-2">Filter by Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="partially_approved">Partially Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <p className="rounded-2xl glass-panel border border-line p-5 text-sm text-ink-2">
            No leave requests found.
          </p>
        ) : (
          filtered.map((r) => (
            <div key={r.id} className="rounded-2xl glass-panel border border-line p-5 hover:bg-surface-2/40 transition-all duration-300">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold text-ink inline-block">{r.employee_name}</span>
                <span className="ml-3 text-xs font-mono text-ink-3">{r.employee_code}</span>
                <span className="text-xs font-mono text-ink-2">
                  {r.leave_type_code} · {dateRange(r.from_date, r.to_date)}
                </span>
                <span className="tnum text-xs font-mono text-ink-3">
                  {r.days} day{r.days === 1 ? '' : 's'}
                </span>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                  r.status === 'approved' ? 'bg-st-approved/20 text-st-approved' :
                  r.status === 'rejected' ? 'bg-st-absent/20 text-st-absent' :
                  r.status === 'partially_approved' ? 'bg-yellow-500/20 text-yellow-600' :
                  'bg-st-pending/20 text-st-pending'
                }`}>
                  {r.status.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.category && (
                  <span className="inline-flex items-center text-[11px] font-mono px-2 py-0.5 rounded-md bg-surface-3 text-ink border border-line">
                    <span className="text-ink-3 mr-1">Category:</span>
                    <strong className="text-ink">{r.category}</strong>
                  </span>
                )}
                {r.reason && <p className="text-sm text-ink-2">{r.reason}</p>}
              </div>
              
              {r.status === 'partially_approved' && (
                <div className="mt-4 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5">
                  <h4 className="text-xs font-bold text-yellow-600 uppercase mb-2">Medical Document Required</h4>
                  {r.decided_note && (
                    <div className="mb-3 p-2.5 rounded-lg bg-surface-2 border border-line text-xs font-mono">
                      <span className="font-bold text-yellow-600 uppercase text-[10px] tracking-wider block mb-0.5">Admin Note to Employee</span>
                      <span className="text-ink">{r.decided_note}</span>
                    </div>
                  )}
                  {r.medical_document_url ? (
                    <div className="flex flex-col gap-3 w-full">
                      <div className="flex flex-wrap items-center gap-4">
                        <span className="text-xs font-mono text-ink-3">
                          Document submitted on {new Date(r.medical_document_submitted_at!).toLocaleDateString()}
                        </span>
                        <a
                          href={proxy(`/api/v1/leave/${r.id}/document/download`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface-2 text-xs font-bold font-mono text-ink hover:bg-surface-3 transition-colors"
                        >
                          📎 View Medical Document
                        </a>
                      </div>
                      
                      {isHr && (
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => decide(r.id, true)}
                            disabled={decidingId === r.id}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-all disabled:opacity-50"
                          >
                            {decidingId === r.id ? 'Saving...' : 'Confirm Final Approve'}
                          </button>
                          <button
                            onClick={() => decide(r.id, false)}
                            disabled={decidingId === r.id}
                            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs font-semibold text-ink hover:text-st-absent hover:border-st-absent/50 transition-all disabled:opacity-50"
                          >
                            Reject
                          </button>
                          {decideError && decideError.id === r.id && (
                            <span className="text-xs text-st-absent ml-2">{decideError.message}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-mono text-ink-3 mb-3">
                        Deadline: {r.medical_document_deadline ? new Date(r.medical_document_deadline).toLocaleDateString() : 'None'}
                      </p>
                      
                      {docUploadId === r.id ? (
                        <div className="flex items-center gap-3">
                          <input 
                            type="file" 
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            className="text-xs font-mono"
                          />
                          <button
                            onClick={() => handleUpload(r.id)}
                            disabled={!uploadFile || uploading}
                            className="rounded-lg bg-ink text-ground px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                          >
                            {uploading ? 'Uploading...' : 'Upload'}
                          </button>
                          <button
                            onClick={() => { setDocUploadId(null); setUploadFile(null); }}
                            className="text-xs font-mono text-ink-3 hover:text-ink"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDocUploadId(r.id)}
                          className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-3 transition-colors"
                        >
                          Upload Document
                        </button>
                      )}
                      {error && docUploadId === r.id && <p className="mt-2 text-xs text-st-absent">{error}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
