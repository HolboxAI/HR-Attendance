import Link from 'next/link';

import { PolicyEditor } from '@/components/PolicyEditor';
import { getLeaveAudit, getLeavePolicy, getLeaveTypes } from '@/lib/api';

export const dynamic = 'force-dynamic';

function Denied() {
  return (
    <div className="rounded border border-st-absent/50 bg-surface p-6">
      <h2 className="text-lg font-semibold">
        <span aria-hidden>○ </span>Not your page
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink-2">
        Leave policy is HR&apos;s to change. If you need a quota or a rule altered,
        ask Ashley — she can do it here without a developer.
      </p>
      <Link href="/" className="mt-3 inline-block text-sm text-accent">
        Back to your attendance
      </Link>
    </div>
  );
}

function Unavailable({ unreachable }: { unreachable: boolean }) {
  return (
    <div className="rounded border border-st-absent/50 bg-surface p-6">
      <h2 className="text-lg font-semibold">Could not load the leave policy</h2>
      <p className="mt-2 text-sm text-ink-2">
        {unreachable ? 'The API is not running.' : 'Try signing out and back in.'}
      </p>
    </div>
  );
}

export default async function LeavePolicyPage() {
  const [policy, types] = await Promise.all([getLeavePolicy(), getLeaveTypes()]);

  // A plain employee - and a manager - gets 403 here. That is the API refusing,
  // not the page hiding a link, which is the distinction that matters.
  if (!policy.ok) {
    if (policy.reason === 'forbidden') return <Denied />;
    return <Unavailable unreachable={policy.reason === 'unreachable'} />;
  }
  if (!types.ok) {
    if (types.reason === 'forbidden') return <Denied />;
    return <Unavailable unreachable={types.reason === 'unreachable'} />;
  }

  const audit = await getLeaveAudit();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Leave policy</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          Everything here is yours to change. Nothing lives in a config file, and no
          change needs a developer or a restart.
        </p>
      </div>

      <PolicyEditor policy={policy.data} types={types.data} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
          What changed, and who changed it
        </h2>
        <p className="max-w-prose text-sm text-ink-2">
          Quotas decide what people are owed, so every edit is kept with its old and
          new value. &ldquo;It says 12 now but I&apos;m sure it was 15&rdquo; is
          answerable here.
        </p>

        {!audit || audit.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing changed yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">What</th>
                  <th className="px-4 py-3 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((r, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0 align-top">
                    <td className="tnum whitespace-nowrap px-4 py-3 text-ink-3">
                      {new Date(r.at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit',
                        minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
                      })}
                    </td>
                    <td className="px-4 py-3">{r.actor}</td>
                    <td className="px-4 py-3 text-ink-2">
                      {r.entity.replace('_', ' ')} · {r.action}
                    </td>
                    <td className="px-4 py-3">
                      {Object.entries(r.changes ?? {}).map(([field, v]) => (
                        <div key={field} className="text-ink-2">
                          <span className="text-ink-3">{field.replace(/_/g, ' ')}:</span>{' '}
                          <span className="text-st-absent">{String(v.old)}</span>
                          {' → '}
                          <span className="text-st-present">{String(v.new)}</span>
                        </div>
                      ))}
                      {r.note && <div className="mt-1 text-xs text-ink-3">{r.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
