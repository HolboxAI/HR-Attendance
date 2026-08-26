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

## 006 - Identity comes from the token, and the parameter is gone  (Aug 2026)

**Decision.** One login for everybody at `POST /auth/login`. Roles stack and are
checked as "at least this rank". The punch endpoint's `employee_code` parameter
and the mobile app's `EMPLOYEE_CODE` constant were DELETED, not deprecated.

**Why the deletion matters more than the auth.** Adding tokens while leaving
`employee_code` accepted would have changed nothing: the old curl still works,
anyone can still punch as anyone, and the system now *looks* secure, which is
worse than visibly insecure. The parameter is the vulnerability; authentication
around it is not a fix. `test_auth.py` asserts against the OpenAPI schema that
the field does not exist, and separately that smuggling it in has no effect.

**Roles stack; they are never exclusive.** Krish is the super admin and punches
in every morning. Ashley runs Operations and punches in. `require_role` takes a
MINIMUM rank, so hr_admin includes manager includes employee. The failure mode
being avoided is the ordinary one where "admin" becomes a separate kind of
account and the two people who run the system can no longer use it.

**One credential per person, no signup.** Two login systems means two sets of
credentials to disable the day someone leaves, and that is the one that gets
forgotten. HR creates accounts with `scripts/seed_users.py`; passwords are
printed once and stored only as a hash.

**Consequences worth knowing.**

- Access tokens are short (30 min) and carry the role; refresh tokens are long,
  rotated on every use, and recorded in `refresh_sessions` so logout means
  something. Role changes and deactivations therefore take effect within one
  access-token lifetime with no revocation machinery for the short half.
- The dashboard holds tokens in httpOnly cookies, so page JavaScript cannot
  read them and an XSS bug does not hand over an admin session. The cost is
  that browser code cannot call the API directly: it goes through
  `app/api/gateway`, which attaches the token server-side. That cost was
  accepted deliberately.
- **Phone binding**, one handset per employee, checked on every punch. The
  escape hatch is what makes it liveable: HR clears a binding, which
  deactivates it, keeps the row, and signs that handset's sessions out. A
  reinstall produces a new install id and so reads as a new phone - the
  conservative answer, and one HR can resolve in ten seconds.
- A manager sees only their reports (`visible_employees`). Out-of-scope lookups
  return 404 rather than 403, so the roster cannot be enumerated by watching
  which codes come back "forbidden".
- Corrections record the actor from the token. An audit trail the caller fills
  in for itself is not an audit trail.

**Still open.** Nobody has a `manager_id` set in the seed, so the manager tier
is exercised by tests rather than by anyone real. And the dashboard has no
check-in flow yet, so an admin still marks their own attendance on their phone.

## 007 - Leave is an attendance feature, not a CRUD module  (Aug 2026)

**Decision.** `recompute_day()` looks up approved leave and holidays and passes
them into `resolve_day()`. Approving, cancelling, or changing the holiday
calendar recomputes every affected day *inside the service call*, before it
returns.

**Why this and not the CRUD.** `resolve_day()` had accepted `is_holiday` and
`is_on_leave` from the beginning; nothing ever passed them. So approved leave
and public holidays both resolved to "absent" - the day Ashley approved Dhruv's
Diwali leave, the board still showed him absent, and so did his month. A leave
module that stores requests and leaves that untouched has delivered nothing.

The recompute lives in `decide()` and `cancel()` rather than in the routes, so
a new caller cannot forget it. A route that forgets leaves the board
contradicting an approval that is sitting right there in the database, and
nobody would find out until someone queried their own attendance.

**A policy change never rewrites history.** This is the trap worth naming.

- Editing a quota applies from the next accrual run forward. Balances already
  earned stay as they are, the page says so before saving, and the edit writes
  an audit row with the old and new values.
- `LeaveRequest.days_consumed` is FROZEN at decision time, not recomputed on
  read. Turning the sandwich rule on in August must not make a leave taken in
  March retroactively cost two more days.
- `AccrualRun` records each month actually credited, with a unique key per
  employee/type/period/month. Accrual is therefore idempotent, and "how much
  have they earned" is a sum of what was granted rather than a calculation from
  today's quota - which would change the answer every time HR edits a number.

**Three cases the resolver now gets right.**

- **A punch on an approved leave day** keeps the day `on_leave`, sets
  `has_exception`, and says so. Both facts are true; a human decides which was
  the mistake. Silently ignoring the punch, or silently cancelling the leave,
  would each destroy evidence.
- **Leave across a weekend or holiday** consumes only working days, unless the
  sandwich rule is on. Leading and trailing non-working days never count -
  applying for "Saturday to Monday" should not bill you for Saturday.
- **Half a day of leave plus half a day worked** is a full day, not an absence.

**Holiday dates are marked confirmed or not.** The fixed-date holidays are
arithmetic; the lunar-calendar festivals are fixed by Gujarat government
notification and move every year. Seeding a guess as fact would mark the whole
company off on the wrong day, so the 16 uncertain ones carry
`is_confirmed=False` and surface in the dashboard as "Check date". Optional
(restricted) holidays are excluded from the closed-office lookup entirely - the
office stays open, so they must not resolve to "holiday" for everyone.

**Still open.** Year-end carry-forward is stored and editable but nothing runs
the roll-over yet: at 31 December, EL should move into next year's `opening` up
to the cap and CL/SL should lapse.

## 007 - Liveness is out of v1, and the gap is written down  (Aug 2026)

**Decision.** The face check stays 1:1 `CompareFaces` with no liveness. The PRD
acceptance line "a photo of a colleague held up to the camera is refused" is
struck, because it asked for an outcome the same document ruled out the
mechanism for.

**Why it was a contradiction, not a trade-off.** `CompareFaces` answers *is this
the same face as the enrolled photo*. A print, or the person's face on a second
phone screen, answers that correctly - it genuinely is their face. Nothing in
the comparison asks *is a living person in front of this camera*. Refusing a
held-up photo requires liveness detection, which the PRD listed under "not in
v1". One of the two had to give, and pretending the criterion was met would
have been the worst option: an acceptance test nobody could pass, quietly
failing in the pilot.

**What is genuinely open.** Not the careless case - a stranger's face does not
match. The open case is co-operative buddy punching: an employee hands their
bound phone to a colleague at the office, along with a photo of themselves.
Device binding and the geofence do not close it. They raise it from "anyone,
anywhere" to "two willing people, on the victim's handset, inside the
building".

**Why accept it at this size.** Seven people who all know each other. The cheat
needs collusion and physical presence, and every punch selfie is stored, so it
is detectable after the fact rather than invisible. Accepting costs nothing;
the alternative puts a per-check fee and a new SDK on the critical path of a
flow with an 8-second budget.

**When it is built, it is ours.** Not AWS Face Liveness. A server-chosen
challenge at punch time - blink, or turn your head - verified across a short
burst of frames, which defeats a static print. Two honest caveats recorded now
so nobody rediscovers them later:

- True *passive* liveness from one still image is an adversarial research
  problem, not a weekend feature. The achievable own-build is
  challenge-response.
- Challenge-response is still beatable by a prepared video replay. It raises
  the cost of cheating; it does not end it.

Revisit at the pilot, on evidence from real punches rather than on principle.
