import { EnrolmentTable } from '@/components/EnrolmentTable';
import { getEnrolments } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function EnrolmentPage() {
  const result = await getEnrolments();

  if (!result.ok) {
    // Three different problems that used to render as one wrong sentence.
    return (
      <div className="bx-card border-st-absent/50 p-6">
        <h2 className="text-lg font-semibold">
          {result.reason === 'unreachable' && "The API isn't running"}
          {result.reason === 'unauthorised' && 'Your session has expired'}
          {result.reason === 'forbidden' && 'Face enrolment is for HR'}
          {!['unreachable', 'unauthorised', 'forbidden'].includes(result.reason) &&
            'Could not load enrolment'}
        </h2>
        {result.reason === 'unreachable' && (
          <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-3 text-xs text-ink-2">
cd apps/api &amp;&amp; .venv/bin/uvicorn app.main:app --reload</pre>
        )}
        {result.reason === 'unauthorised' && (
          <p className="mt-2 text-sm text-ink-2">
            <a href="/login" className="text-accent underline">Sign in again</a> to continue.
          </p>
        )}
        {result.reason === 'forbidden' && (
          <p className="mt-2 max-w-prose text-sm text-ink-2">
            Reference photos are taken by HR, not by the employee — someone
            authorised has to vouch that the face belongs to the person.
          </p>
        )}
      </div>
    );
  }

  const { summary, rows } = result.data;
  const complete = summary.missing === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Face enrolment</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          One reference photo per person. Every check-in selfie is compared against it, so
          until someone is enrolled there is nothing to compare to and the face check cannot
          mean anything for them.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="bx-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">Enrolled</div>
          <div className="tnum mt-1 font-display text-2xl font-bold">
            {summary.enrolled}<span className="text-ink-3">/{summary.headcount}</span>
          </div>
        </div>
        <div className="bx-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">Still missing</div>
          <div className={`tnum mt-1 font-display text-2xl font-bold ${
            complete ? 'text-st-present' : 'text-st-late'}`}
          >
            {summary.missing}
          </div>
        </div>
        <div className="bx-card p-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-3">Matching by</div>
          <div className="mt-1 font-display text-2xl font-bold">
            {summary.face_provider === 'rekognition' ? 'Rekognition' : 'Stub'}
          </div>
        </div>
      </section>

      {/*
        The honest statement of what the face check is currently worth. While
        enrolment is not required, an unenrolled person still checks in - the
        check is recorded as not performed rather than as a pass.
      */}
      <section
        className={`rounded border p-5 ${
          summary.enrolment_required
            ? 'border-st-present/40 bg-surface'
            : 'border-st-late/40 bg-surface'
        }`}
      >
        <h2 className={`text-sm font-semibold uppercase tracking-widest ${
          summary.enrolment_required ? 'text-st-present' : 'text-st-late'}`}
        >
          {summary.enrolment_required
            ? '● Enrolment required'
            : '◐ Enrolment not yet required'}
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink-2">
          {summary.enrolment_required
            ? 'Someone without a reference photo cannot check in. Their attempt is still recorded, with the reason.'
            : 'Someone without a reference photo can still check in. Their punch is recorded with the face check marked as not performed — never as a pass. Set REQUIRE_FACE_ENROLMENT=true once this screen reads 100%.'}
        </p>
        {summary.face_provider !== 'rekognition' && (
          <p className="mt-2 max-w-prose text-sm text-ink-3">
            The stub provider accepts any selfie that has a reference photo to compare
            against. It proves the plumbing, not the person. Real matching starts when
            FACE_PROVIDER=rekognition.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">Everyone</h2>
        <p className="max-w-prose text-sm text-ink-2">
          Use a straight-on, well-lit photo. Replacing one keeps the old photo on file: the
          record of which photo was in force on a given day is what settles a dispute later.
        </p>
        <EnrolmentTable rows={rows} />
      </section>
    </div>
  );
}
