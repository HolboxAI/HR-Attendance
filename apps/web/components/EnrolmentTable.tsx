'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { API, dayMonth, enrolmentPhotoUrl, type EnrolmentRow } from '@/lib/api';

type Busy = { code: string; what: 'upload' | 'remove' } | null;

export function EnrolmentTable({ rows }: { rows: EnrolmentRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  // Bumped after every change so the <img> src changes and the browser fetches
  // the new photo instead of showing the cached previous one.
  const [version, setVersion] = useState(1);
  // Two-step inline confirm rather than window.confirm: a native dialog is
  // suppressed outright in some embedded browsers, which turns a destructive
  // action into one that silently does nothing.
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(code: string, file: File) {
    setError(null);
    setBusy({ code, what: 'upload' });
    const body = new FormData();
    body.append('photo', file);
    body.append('employee_code', code);
    try {
      const res = await fetch(`${API}/api/v1/admin/enrolments`, { method: 'POST', body });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        setError({ code, message: detail?.detail ?? `Upload failed (${res.status})` });
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

  async function remove(code: string) {
    setConfirming(null);
    setError(null);
    setBusy({ code, what: 'remove' });
    try {
      const res = await fetch(`${API}/api/v1/admin/enrolments/${code}`, { method: 'DELETE' });
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
    <div className="overflow-x-auto rounded border border-line bg-surface">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
            <th className="px-4 py-3 font-medium">Photo</th>
            <th className="px-4 py-3 font-medium">Who</th>
            <th className="px-4 py-3 font-medium">Enrolled</th>
            <th className="px-4 py-3 font-medium">Since</th>
            <th className="px-4 py-3 font-medium">Photos</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const working = busy?.code === r.employee_code;
            return (
              <tr key={r.employee_code} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3">
                  {r.enrolled ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={enrolmentPhotoUrl(r.employee_code, version)}
                      alt={`Reference photo for ${r.full_name}`}
                      className="h-11 w-11 rounded object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-11 w-11 items-center justify-center rounded border border-dashed border-line text-ink-3"
                      aria-hidden
                    >
                      ○
                    </span>
                  )}
                </td>

                <td className="px-4 py-3">
                  {r.full_name}
                  <span className="ml-2 text-xs text-ink-3">{r.employee_code}</span>
                  {r.department && (
                    <div className="text-xs text-ink-3">{r.department}</div>
                  )}
                </td>

                {/* Word and glyph, never colour alone. */}
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span aria-hidden className={r.enrolled ? 'text-st-present' : 'text-st-absent'}>
                      {r.enrolled ? '●' : '○'}
                    </span>
                    <span className={r.enrolled ? 'text-st-present' : 'text-st-absent'}>
                      {r.enrolled ? 'Enrolled' : 'No photo'}
                    </span>
                  </span>
                </td>

                <td className="tnum px-4 py-3 text-ink-3">{dayMonth(r.enrolled_at)}</td>
                <td className="tnum px-4 py-3 text-ink-3">{r.photo_count || '—'}</td>

                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={(el) => { inputs.current[r.employee_code] = el; }}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Reset first, so re-picking the same file still fires
                        // onChange if the previous attempt was rejected.
                        e.target.value = '';
                        if (file) upload(r.employee_code, file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => inputs.current[r.employee_code]?.click()}
                      className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-[#1A1206] disabled:opacity-50"
                    >
                      {working && busy?.what === 'upload'
                        ? 'Uploading…'
                        : r.enrolled ? 'Replace' : 'Add photo'}
                    </button>
                    {r.enrolled && confirming !== r.employee_code && (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => setConfirming(r.employee_code)}
                        className="rounded border border-line px-3 py-1.5 text-xs text-ink-2 disabled:opacity-50"
                      >
                        {working && busy?.what === 'remove' ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    )}
                    {r.enrolled && confirming === r.employee_code && (
                      <>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => remove(r.employee_code)}
                          className="rounded border border-st-absent px-3 py-1.5 text-xs text-st-absent disabled:opacity-50"
                        >
                          Confirm withdraw
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="rounded px-2 py-1.5 text-xs text-ink-3"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                  {confirming === r.employee_code && (
                    <p className="mt-2 max-w-[38ch] text-xs text-ink-3">
                      {r.full_name} counts as not enrolled until a new photo is added. The
                      old photo stays on file for the audit trail — nothing is deleted.
                    </p>
                  )}
                  {error?.code === r.employee_code && (
                    <p role="alert" className="mt-2 max-w-[36ch] text-xs text-st-absent">
                      {error.message}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
