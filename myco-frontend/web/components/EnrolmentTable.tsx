'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ArrowUpRight, Camera, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { HoverProfile } from '@/components/HoverProfile';

import { CameraCaptureModal } from '@/components/CameraCaptureModal';
import { dayMonth, enrolmentPhotoUrl, proxy, type EnrolmentRow } from '@/lib/format';

type Busy = { code: string; what: 'upload' | 'remove' } | null;

export function EnrolmentTable({ rows }: { rows: EnrolmentRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [version, setVersion] = useState(1);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cameraModal, setCameraModal] = useState<{ code: string; name: string } | null>(null);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(code: string, file: File) {
    setError(null);
    setBusy({ code, what: 'upload' });
    const body = new FormData();
    body.append('photo', file);
    body.append('employee_code', code);
    try {
      const res = await fetch(proxy('/api/v1/admin/enrolments'), { method: 'POST', body });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setError({ code, message: detail?.detail ?? `Upload failed (${res.status})` });
      } else {
        setVersion((v) => v + 1);
        setCameraModal(null);
        router.refresh();
      }
    } catch {
      setError({ code, message: 'Could not reach the API' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(code: string) {
    setConfirming(null);
    setError(null);
    setBusy({ code, what: 'remove' });
    try {
      const res = await fetch(proxy(`/api/v1/admin/enrolments/${code}`), { method: 'DELETE' });
      if (!res.ok) {
        setError({ code, message: `Could not withdraw (${res.status})` });
      } else {
        setVersion((v) => v + 1);
        router.refresh();
      }
    } catch {
      setError({ code, message: 'Could not reach the API' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="overflow-x-auto glass-panel rounded-2xl">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line/80 bg-surface/50 text-[11px] font-mono uppercase tracking-wider text-ink-3">
              <th className="px-5 py-3.5 font-semibold">Biometric Reference</th>
              <th className="px-5 py-3.5 font-semibold">Employee</th>
              <th className="px-5 py-3.5 font-semibold">Status</th>
              <th className="px-5 py-3.5 font-semibold">Enrolled Since</th>
              <th className="px-5 py-3.5 font-semibold">Audit Count</th>
              <th className="px-5 py-3.5 font-semibold">Capture & Actions</th>
            </tr>
          </thead>
          <tbody
            onMouseLeave={() => setHoveredCode(null)}
            className="divide-y divide-line/40"
          >
            {rows.map((r) => {
              const working = busy?.code === r.employee_code;
              const isHovered = hoveredCode === r.employee_code;
              const isDimmed = hoveredCode !== null && !isHovered;
              return (
                <tr
                  key={r.employee_code}
                  onMouseEnter={() => setHoveredCode(r.employee_code)}
                  style={{
                    opacity: isDimmed ? 0.25 : 1,
                    transition: 'all 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  className={`group cursor-pointer transition-all duration-300 ${
                    isHovered ? 'bg-surface-2/80' : 'hover:bg-surface-2/40'
                  }`}
                >
                  <td className="px-5 py-3.5">
                    {r.enrolled ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={enrolmentPhotoUrl(r.employee_code, r.photo_count)}
                        alt={`Reference photo for ${r.full_name}`}
                        className="size-12 rounded-xl object-cover border border-line shadow-sm ring-1 ring-white/10"
                      />
                    ) : (
                      <span
                        className="flex size-12 items-center justify-center rounded-xl border border-dashed border-line/80 bg-surface-2/30 text-ink-3 font-mono text-xs"
                        aria-hidden
                      >
                        <ImageIcon className="size-4 opacity-50" />
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-3.5">
                    <HoverProfile data={{ name: r.full_name, department: r.department, code: r.employee_code }}>
                      <span className="inline-block transition-transform duration-300 group-hover:translate-x-3">
                        <span className="flex items-center gap-1.5 font-semibold text-ink group-hover:text-accent transition-colors">
                          {r.full_name}
                          <ArrowUpRight className="size-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-ink shrink-0" aria-hidden />
                        </span>
                        <span className="block text-xs font-mono text-ink-3">{r.employee_code}</span>
                        {r.department && (
                          <span className="block text-[11px] text-ink-3/80 font-mono">{r.department}</span>
                        )}
                      </span>
                    </HoverProfile>
                  </td>

                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-surface-2 text-ink border border-line">
                      <span className={`size-1.5 rounded-full ${r.enrolled ? 'bg-ink' : 'bg-ink-3/40'}`} />
                      {r.enrolled ? 'Enrolled' : 'No Reference'}
                    </span>
                  </td>

                  <td className="px-5 py-3.5 text-xs font-mono text-ink-3">{dayMonth(r.enrolled_at)}</td>
                  <td className="px-5 py-3.5 text-xs font-mono text-ink-3">{r.photo_count || '—'}</td>

                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={(el) => { inputs.current[r.employee_code] = el; }}
                        type="file"
                        accept="image/jpeg,image/png"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) upload(r.employee_code, file);
                        }}
                      />

                      {/* Option 1: Live Webcam Snapshot */}
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => setCameraModal({ code: r.employee_code, name: r.full_name })}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-ground px-3 py-1.5 text-xs font-bold shadow-xs hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        title="Open camera to snap photo"
                      >
                        <Camera className="size-3.5" />
                        <span>Camera</span>
                      </button>

                      {/* Option 2: Choose File from Disk */}
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => inputs.current[r.employee_code]?.click()}
                        className="inline-flex items-center gap-1.5 rounded-xl glass-panel border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        title="Choose photo from computer"
                      >
                        <Upload className="size-3.5 text-ink-3" />
                        <span>{working && busy?.what === 'upload' ? 'Uploading…' : 'File'}</span>
                      </button>

                      {/* Withdraw Option */}
                      {r.enrolled && confirming !== r.employee_code && (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => setConfirming(r.employee_code)}
                          className="rounded-xl p-1.5 text-ink-3 hover:text-st-absent hover:bg-st-absent/10 transition-colors disabled:opacity-50"
                          title="Withdraw reference photo"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}

                      {r.enrolled && confirming === r.employee_code && (
                        <div className="flex items-center gap-1.5 animate-fadeIn">
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => remove(r.employee_code)}
                            className="rounded-xl border border-st-absent/60 bg-st-absent/15 px-2.5 py-1 text-xs font-medium text-st-absent hover:bg-st-absent/25 transition-colors disabled:opacity-50"
                          >
                            {working && busy?.what === 'remove' ? 'Withdrawing…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(null)}
                            className="rounded-xl px-2 py-1 text-xs text-ink-3 hover:text-ink transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {confirming === r.employee_code && (
                      <p className="mt-2 max-w-[38ch] text-[11px] text-ink-3 font-mono">
                        {r.full_name} will be unenrolled until a new photo is submitted. Old vectors remain archived.
                      </p>
                    )}

                    {error?.code === r.employee_code && (
                      <p role="alert" className="mt-2 max-w-[36ch] text-xs text-st-absent font-mono font-medium">
                        ⚠️ {error.message}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Live Camera Modal */}
      {cameraModal && (
        <CameraCaptureModal
          open={!!cameraModal}
          employeeCode={cameraModal.code}
          employeeName={cameraModal.name}
          busy={busy?.code === cameraModal.code && busy?.what === 'upload'}
          // The refusal must land in the modal the person is looking at.
          // It used to render only in the table row - behind the dialog
          // backdrop - so a duplicate face just looked like a button that
          // did nothing, and the obvious response was to keep trying.
          error={error?.code === cameraModal.code ? error.message : null}
          onClose={() => setCameraModal(null)}
          onCapture={(file) => upload(cameraModal.code, file)}
        />
      )}
    </>
  );
}

