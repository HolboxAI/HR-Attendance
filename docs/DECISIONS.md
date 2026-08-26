# Decisions

## 001 - No gate hardware for v1  (Aug 2026)

**Decision.** Attendance is captured by the mobile app: GPS geofence + face
match. No biometric reader integration.

**Why.** Senior's call - hardware integration is disproportionate effort for
what is essentially a check-in. Staff already punch this way in MyCo, so it
matches an existing habit rather than introducing a new one.

**Cost of being wrong: low.** The ingest core was built vendor-neutral, so the
gate adapter still exists at `apps/api/app/adapters/zkteco_adms.py`, unwired.
If a reader is ever bought, import it in `main.py`. Nothing downstream changes,
because everything downstream only ever sees a normalized punch event.

## 002 - AWS Rekognition for face verification  (Aug 2026)

**Decision.** 1:1 verification with `CompareFaces` against one enrolled photo
per employee. Not 1:N search.

**Why.** The employee is already logged in, so we only need "is this them?",
which is more accurate than "who is this?", cheaper, and does not degrade as
headcount grows. At ~2,600 calls/month this costs roughly $3.

**What we are NOT storing.** No face embeddings, no image bytes in the
database - only an S3 key for the enrolled reference photo. Biometric data is
the one thing you do not want sitting in a table you might one day dump to a
laptop.

**Known gap.** No liveness detection, so a held-up photo of a colleague could
pass. Mitigated for now by: camera-only capture (no gallery), geofence, and
one-phone-per-employee binding. If it becomes a real problem, Rekognition
Face Liveness is the upgrade path.

## 003 - Postgres and API on one small EC2  (Aug 2026)

**Decision.** Single t3.small-class instance runs both. Postgres bound to
localhost, nginx terminating TLS in front of the API.

**Why.** 60 employees generate on the order of 2,600 punches a month. That is
not a scaling problem, and splitting tiers would add operational work with no
benefit. Revisit if headcount passes a few hundred or a second office opens.

## 004 - Prototype stores everything in a local folder  (Aug 2026)

**Decision.** No EC2, no Postgres, no S3, no AWS account. A SQLite file and a
photo folder under `data/` at the repo root. Runs on a laptop with `pip install`
and nothing else.

**Why.** It's a prototype. Deployment can wait until there is something worth
deploying, and every hour spent on servers now is an hour not spent on the
thing being demonstrated.

**Cost of being wrong: near zero**, and that was designed for:

- Column types are dialect-portable (`app/db/types.py`) - `GUID` becomes a real
  Postgres UUID and `JSONType` becomes JSONB automatically. Moving is one
  connection string, not a model rewrite.
- Photo storage is behind a small interface (`app/services/storage.py`).
  `LocalStorage` becomes `S3Storage`; callers only ever see an opaque key.
- Face verification already has two implementations behind one interface.
  `FACE_PROVIDER=stub` today, `rekognition` when there's an account.

**Known limitation.** SQLite journal mode is forced to PERSIST, falling back to
MEMORY, because the default deletes the rollback journal on every commit and
some synced or mounted filesystems refuse that delete - which surfaces as an
unhelpful "disk I/O error". Slightly weaker crash-safety mid-transaction. Fine
for a prototype, and it disappears entirely on Postgres.

**Also note.** The punch endpoint stamps punches with SERVER time, never a time
sent by the phone. A phone's clock is attacker-controlled. This means demo
scripts cannot backdate punches over HTTP and must use the service layer - a
mild inconvenience that is the correct trade.

## 005 - "Not enrolled" is recorded as unverified, never as a match  (Aug 2026)

**Decision.** An employee with no reference photo gets `face_ok = NULL` and
`raw_payload.face_checked = false` on their punch - not `face_ok = true`.
Whether the punch is *accepted* is a separate switch, `REQUIRE_FACE_ENROLMENT`,
which is `false` during rollout and `true` from the pilot onwards.

**Why.** The punch endpoint used to call the face service with an empty
reference image, and the stub dutifully returned "matched, 99% similar". That
wrote a passing face check into `punch_events` for a comparison that never
happened. It is the worst possible failure mode: not an absent control, but a
fabricated record of a control - and one that reads as evidence in exactly the
dispute it would be quoted in.

Two honest outcomes exist and no third: refuse the punch, or let it through and
record that no check was performed. Which one you get is a policy switch. What
you never get is a manufactured pass.

**Consequences.**

- The stub and the Rekognition provider both refuse an empty reference image.
  Neither can be coaxed into matching against nothing.
- A row whose photo file has vanished from storage counts as *not enrolled*.
  A missing reference degrades to "unverified", never to "verified".
- Enrolment is append-only, like punches. Re-enrolling deactivates the old row
  and adds a new one; withdrawing deactivates without deleting. Which photo was
  in force on a given day stays answerable, which is the point.
- The reference photo is quality-checked at upload, not at punch time. A bad
  reference silently poisons every future comparison for that person, and
  upload is the only cheap moment to catch it.

**Still true and still the gap.** `FACE_PROVIDER=stub` accepts any selfie that
has a reference photo to compare against. Enrolment makes the plumbing real;
only Rekognition makes the *matching* real.
