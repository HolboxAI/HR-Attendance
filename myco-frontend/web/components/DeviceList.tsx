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
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

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
        <p role="alert" className="rounded-xl border border-line glass-panel px-4 py-3 text-xs text-st-absent font-mono">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl border border-line glass-panel px-4 py-3 text-xs text-ink font-mono">
          {done}
        </p>
      )}

      <p className="text-xs text-ink-3 font-mono">{bound} of {rows.length} employees have a phone bound.</p>

      <div className="overflow-x-auto rounded-2xl glass-panel border border-line">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
              <th className="px-4 py-3">Employee</th>
              <th className="px-4 py-3">Binding</th>
              <th className="px-4 py-3">Platform</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody
            onMouseLeave={() => setHoveredCode(null)}
          >
            {rows.map((r) => {
              const isHovered = hoveredCode === r.employee_code;
              const isDimmed = hoveredCode !== null && !isHovered;
              return (
                <tr
                  key={r.employee_code}
                  onMouseEnter={() => setHoveredCode(r.employee_code)}
                  className={`border-b border-line/60 last:border-0 transition-all duration-300 ${
                    isHovered ? 'bg-surface-2/60' : 'hover:bg-surface-2/30'
                  } ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold text-ink transition-transform duration-300 inline-block group-hover:translate-x-1.5">{r.full_name}</span>
                    <span className="ml-2 text-xs font-mono text-ink-3">{r.employee_code}</span>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {r.bound
                      ? <span className="text-ink font-semibold">Bound</span>
                      : <span className="text-ink-3">No phone registered</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-2 font-mono">
                    {r.bound ? `${r.platform ?? '?'}${r.model ? ` · ${r.model}` : ''}` : '—'}
                  </td>
                  <td className="tnum px-4 py-3 text-ink-3 font-mono">
                    {r.last_seen_at ? `${dayMonth(r.last_seen_at)} · ${hhmm(r.last_seen_at)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.bound && (
                      <button
                        type="button"
                        onClick={() => { setDone(null); setConfirmFor(r); }}
                        className="rounded-xl border border-line glass-panel px-3 py-1.5 text-xs font-mono font-semibold text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer"
                      >
                        Unbind phone
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
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
