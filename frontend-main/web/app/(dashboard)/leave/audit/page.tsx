import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { getLeaveAudit, getLeavePolicy } from '@/lib/api';
import { dayMonth, hhmm } from '@/lib/format';

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
        <div className="bx-card px-6 py-10 text-center text-sm text-ink-3">
          No changes recorded yet. Policy edits, quota changes, accrual runs and
          carry-forward runs will appear here with who did them and what changed.
        </div>
      ) : (
        <div className="bx-card divide-y divide-line/60">
          {rows.map((r, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-medium">{r.actor}</span>
                <span className="text-ink-2">{r.action} · {r.entity.replace(/_/g, ' ')}</span>
                <span className="tnum ml-auto text-xs text-ink-3">
                  {dayMonth(r.at)} · {hhmm(r.at)}
                </span>
              </div>
              {Object.keys(r.changes).length > 0 && (
                <dl className="mt-1.5 space-y-0.5">
                  {Object.entries(r.changes).map(([field, ch]) => (
                    <div key={field} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <dt className="text-ink-3">{field.replace(/_/g, ' ')}:</dt>
                      <dd className="tnum">
                        <span className="text-ink-3 line-through">{String(ch.old ?? '—')}</span>
                        <span aria-hidden> → </span>
                        <span className="sr-only">changed to</span>
                        <span className="font-medium text-ink">{String(ch.new ?? '—')}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {r.note && <p className="mt-1 text-xs text-ink-2">{r.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
