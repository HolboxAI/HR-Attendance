import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { getLeaveAudit, getLeavePolicy } from '@/lib/api';
import { dayMonth, hhmm } from '@/lib/format';
import { HoverProfile } from '@/components/HoverProfile';

export const dynamic = 'force-dynamic';

/**
 * The leave audit trail: who changed what, with old and new values. This is
 * the leave-scoped log the backend has today - there is deliberately no
 * pretend "global audit" page, because that endpoint does not exist yet
 * (frontend PRD §5.1).
 */
export default async function LeaveAuditPage() {
  // Policy is the cheapest hr_admin-gated call: it tells us whether this
  // viewer may see the audit page at all, with a reason instead of a blank.
  const gate = await getLeavePolicy();
  if (!gate.ok) {
    return (
      <ErrorState
        reason={gate.reason}
        forbiddenText="The leave audit log is for HR administrators."
      />
    );
  }

  const rows = (await getLeaveAudit(120)) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave audit"
        sub="Every change to leave settings and every run of accrual or carry-forward, with old and new values. Covers leave only - a product-wide audit log needs an API that does not exist yet."
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl glass-panel border border-line px-6 py-10 text-center text-xs font-mono text-ink-3">
          No changes recorded yet. Policy edits, quota changes, accrual runs and
          carry-forward runs will appear here with who did them and what changed.
        </div>
      ) : (
        <div className="rounded-2xl glass-panel border border-line divide-y divide-line/60 overflow-hidden">
          {rows.map((r, i) => (
            <div key={i} className="px-5 py-3.5 hover:bg-surface-2/30 transition-colors">
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <HoverProfile data={{ name: r.actor, code: r.actor }}>
                  <span className="font-semibold text-ink inline-block transition-transform duration-300 hover:translate-x-1 cursor-default">{r.actor}</span>
                </HoverProfile>
                <span className="text-ink-2 font-mono">{r.action} · {r.entity.replace(/_/g, ' ')}</span>
                <span className="tnum ml-auto text-[11px] font-mono text-ink-3">
                  {dayMonth(r.at)} · {hhmm(r.at)}
                </span>
              </div>
              {Object.keys(r.changes).length > 0 && (
                <dl className="mt-2 space-y-1">
                  {Object.entries(r.changes).map(([field, ch]) => (
                    <div key={field} className="flex flex-wrap items-baseline gap-x-2 text-xs font-mono">
                      <dt className="text-ink-3">{field.replace(/_/g, ' ')}:</dt>
                      <dd className="tnum">
                        <span className="text-ink-3 line-through">{String(ch.old ?? '—')}</span>
                        <span aria-hidden className="text-ink-3"> → </span>
                        <span className="sr-only">changed to</span>
                        <span className="font-bold text-ink">{String(ch.new ?? '—')}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {r.note && <p className="mt-1.5 text-xs text-ink-2 font-mono">{r.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
