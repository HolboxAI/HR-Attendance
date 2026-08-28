import { EnrolmentTable } from '@/components/EnrolmentTable';
import { PendingEnrolments } from '@/components/PendingEnrolments';
import { getEnrolments, getEnrolmentRequests } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EnrolmentPage() {
  const data = await getEnrolments();
  const requests = (await getEnrolmentRequests()) ?? [];

  if (!data) {
    return (
      <div className="rounded-2xl border border-st-absent/50 glass-panel p-6">
        <h2 className="text-lg font-semibold text-st-absent">The API isn&apos;t running</h2>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-2/80 p-3 text-xs text-ink-2 font-mono">
cd apps/api &amp;&amp; .venv/bin/uvicorn app.main:app --reload</pre>
      </div>
    );
  }

  const { summary, rows } = data;
  const complete = summary.missing === 0;

  return (
    <div className="space-y-8 fade-in-up">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Biometric Face Enrolment</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-3">
          One high-resolution reference photo per employee. Live webcam snapshots and uploaded files are converted to biometric embeddings for kiosk and mobile punch verification.
        </p>
      </div>

      <PendingEnrolments rows={requests} />

      <section className="grid gap-3.5 sm:grid-cols-3">
        <div className="glass-panel rounded-2xl p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-3">Enrolled Headcount</div>
          <div className="tnum mt-2 font-display text-3xl font-extrabold text-ink">
            {summary.enrolled}<span className="text-ink-3 text-xl font-normal">/{summary.headcount}</span>
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-3">Pending Reference</div>
          <div className="tnum mt-2 font-display text-3xl font-extrabold text-ink">
            {summary.missing}
          </div>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-3">Matching Engine</div>
          <div className="mt-2 font-display text-2xl font-bold text-ink">
            {summary.face_provider === 'rekognition' ? 'AWS Rekognition' : 'Stub Provider'}
          </div>
        </div>
      </section>

      {/* Enforcement status */}
      <section className="rounded-2xl glass-panel p-5 border border-line">
        <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
          {summary.enrolment_required
            ? '● Enrolment Enforcement Active'
            : '○ Enrolment Enforcement Optional'}
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2 leading-relaxed">
          {summary.enrolment_required
            ? 'Team members without a registered face photo cannot check in. Unenrolled punch attempts are rejected and logged.'
            : 'Team members without a registered photo can still check in. Punch attempts are recorded with the biometric check logged as not performed.'}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-ink-3">
            Employee Biometric Directory
          </h2>
          <span className="text-[11px] font-mono text-ink-3">
            Supports Webcam Capture & File Upload
          </span>
        </div>
        <EnrolmentTable rows={rows} />
      </section>
    </div>
  );
}
