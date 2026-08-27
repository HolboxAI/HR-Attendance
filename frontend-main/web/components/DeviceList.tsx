'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Smartphone } from 'lucide-react';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { dayMonth, hhmm, proxy, type DeviceRow } from '@/lib/format';

/**
 * Bound handsets, with the escape hatch that makes binding livable: unbind a
 * lost phone. DELETE /admin/devices/{code} deactivates the binding AND signs
 * out that phone's sessions - the confirm dialog says so, because "unbind"
 * that leaves a stolen phone signed in would be a lie.
 */
export function DeviceList({ rows }: { rows: DeviceRow[] }) {
  const router = useRouter();
  const [confirmFor, setConfirmFor] = useState<DeviceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function unbind(row: DeviceRow) {
    setBusy(true);
    setError(null);
    const res = await fetch(proxy(`/api/v1/admin/devices/${row.employee_code}`), {
      method: 'DELETE',
    }).catch(() => null);
    setBusy(false);
    setConfirmFor(null);
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setError(body?.detail ?? `Could not unbind ${row.employee_code}'s phone.`);
      return;
    }
    const body = await res.json().catch(() => null);
    setDone(
      `${row.full_name}'s phone is unbound${
        body?.sessions_signed_out ? ` and ${body.sessions_signed_out} session(s) signed out` : ''
      }. They can register a new handset by signing in on it.`,
    );
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Smartphone}
        title="No employees yet"
        hint="Handsets appear here the first time someone signs in on the mobile app."
      />
    );
  }

  const bound = rows.filter((r) => r.bound).length;

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-md bg-st-absent/10 px-3 py-2 text-xs text-st-absent">
          <span aria-hidden>○ </span>{error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-st-present/10 px-3 py-2 text-xs text-st-present">
          <span aria-hidden>● </span>{done}
        </p>
      )}

      <p className="text-xs text-ink-3">{bound} of {rows.length} employees have a phone bound.</p>

      <div className="overflow-x-auto bx-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 font-medium">Binding</th>
              <th className="px-4 py-3 font-medium">Platform</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_code} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium">{r.full_name}</span>
                  <span className="ml-2 text-xs text-ink-3">{r.employee_code}</span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.bound
                    ? <span className="text-st-present"><span aria-hidden>● </span>Bound</span>
                    : <span className="text-ink-3"><span aria-hidden>○ </span>No phone registered</span>}
                </td>
                <td className="px-4 py-3 text-xs text-ink-2">
                  {r.bound ? `${r.platform ?? '?'}${r.model ? ` · ${r.model}` : ''}` : '—'}
                </td>
                <td className="tnum px-4 py-3 text-xs text-ink-3">
                  {r.last_seen_at ? `${dayMonth(r.last_seen_at)} · ${hhmm(r.last_seen_at)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.bound && (
                    <button
                      type="button"
                      onClick={() => { setDone(null); setConfirmFor(r); }}
                      className="rounded-md border border-st-absent/60 px-2.5 py-1 text-xs text-st-absent hover:bg-st-absent/10"
                    >
                      Unbind phone
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmFor !== null}
        title={`Unbind ${confirmFor?.full_name}'s phone?`}
        consequence="The handset loses its binding and every session on it is signed out immediately - a lost phone cannot refresh its way back in. They register a new phone simply by signing in on it. Do this when a phone is lost, replaced, or wiped."
        confirmLabel="Unbind & sign out"
        tone="danger"
        busy={busy}
        onConfirm={() => confirmFor && unbind(confirmFor)}
        onClose={() => setConfirmFor(null)}
      />
    </div>
  );
}
