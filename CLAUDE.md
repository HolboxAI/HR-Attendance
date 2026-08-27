# Boxcode HRMS — context for Claude

Attendance-first HR platform for Boxcode. ~7 staff today, built for <60.
One office: IIMA Ventures, Ahmedabad. India only. Prototype stage — no
deployment, everything runs locally.

Owner: Krish. Team: Nikunj, Shivam, Daksh, Dhruv, Ashley, Ritesh.

## Run it

    ./run.sh              dashboard :3000, API :8000
    ./run.sh --lan        also reachable from a phone on the same WiFi
    ./fix-deps.sh         nuke and reinstall deps for this machine

Needs **Python 3.10+** (macOS ships 3.9, which is EOL and lacks `X | None`
syntax). `run.sh` finds the newest Python automatically.

## Verify before claiming anything works

    apps/api/.venv/bin/python apps/api/tests/test_resolver.py    # 30+ assertions
    apps/api/.venv/bin/python apps/api/tests/test_geofence.py    # 15 groups
    apps/api/.venv/bin/python apps/api/tests/test_enrolment.py   # 19 groups
    apps/api/.venv/bin/python apps/api/tests/test_auth.py        # the auth checklist
    apps/api/.venv/bin/python apps/api/tests/test_leave.py       # the leave checklist
    apps/api/.venv/bin/python apps/api/tests/test_export.py      # month-end register
    apps/api/.venv/bin/python apps/api/tests/test_offline_punch.py  # the offline queue
    apps/api/.venv/bin/python apps/api/tests/test_retention.py   # photo deletion
    apps/api/.venv/bin/python apps/api/tests/test_migrations.py  # schema upgrades
    apps/api/.venv/bin/python apps/api/scripts/demo_day.py       # end-to-end
    cd apps/web && npx tsc --noEmit
    cd apps/mobile && npx tsc --noEmit

`test_auth.py` and `test_leave.py` each print the "Definition of done" checklist
from their brief with every box ticked or not. Read that summary, not the word
"passing".

`demo_day.py` signs in over HTTP, registers a handset, posts real punches, and
prints what HR would see. It has caught three real bugs. Run it after touching
attendance. It uses a throwaway database in a temp directory, so it neither
needs a real password nor leaves demo punches in `data/boxcode.db`.

## Architecture — the one rule

Every capture method produces the SAME normalized punch event. Adapters
translate; the core is vendor-neutral.

    capture → punch_events → resolver → attendance_day → everything else

- **`punch_events` is append-only.** Never UPDATE or DELETE it. Corrections are
  new rows.
- **`attendance_day` is derived.** Safe to delete and recompute. Never
  hand-edit it — fix the input and recompute, so the number always matches the
  evidence.
- **`app/services/resolver.py` is a pure function.** No DB, no clock. `as_of` is
  passed in. Keep it that way; it is why the tests are cheap and total.
- Rejected punches are STORED with their reason and excluded from hours. Never
  silently drop one — that is how attendance disputes become unwinnable.

## Where things live

    apps/api/               FastAPI. The product. Everything below is a client.
      app/api/routes/       HTTP only - parse, authorise, delegate, respond
      app/services/         the logic worth testing (resolver, leave, export...)
      app/models/           SQLAlchemy tables
      app/adapters/         vendor translators (zkteco parked here)
      scripts/              seed, init_db, seed_users, seed_leave, demo_day
      tests/                plain python, no pytest - run them directly
    apps/web/               Next.js dashboard. A CONSUMER of the API.
    apps/mobile/            Expo app. Also a consumer.
    docs/                   PLAN, PRD, DECISIONS, briefs, recovered artifacts
    data/                   SQLite + uploads. Gitignored. Never commit it.

## The API is the product; the UIs are clients

35 endpoints, all under `/api/v1`, all documented at `/docs` and machine-
readable at `/openapi.json`. Nothing in the API imports anything from
`apps/web` or `apps/mobile`, and it never will. That is what makes either
front end replaceable without touching the backend.

    auth        login, refresh, logout, me, set-password
    mobile      me, month, punch                    (the employee's own data)
    leave       types, balance, request, my-requests, cancel   (also theirs)
    admin       board, month, rejected, correct, devices, export/month.csv
    admin/leave pending, decide, balances, accrue, policy, types, audit
    admin       holidays, enrolments (+ photo)
    ingest      the parked gate-reader path, closed unless DEVICE_INGEST_KEY

Two rules a client must follow, and they are the only two:

1. **Send `Authorization: Bearer <access token>`.** Identity comes from the
   token; no endpoint takes an employee identifier in the body.
2. **Send `X-Install-Id` on `/mobile/punch`** - the handset binding is checked
   on every punch.

If you replace `apps/web`, generate a typed client from `/openapi.json` rather
than hand-writing fetch calls, and read `apps/web/lib/session.ts` first: the
httpOnly-cookie + gateway pattern there is the only non-obvious part, and it
exists so page JavaScript can never read a token.

## Decisions already made (see docs/DECISIONS.md before revisiting)

1. **No gate hardware.** Mobile app only: GPS geofence + face match. The ZKTeco
   adapter is parked, intact and unwired, at `app/adapters/zkteco_adms.py`.
2. **AWS Rekognition, 1:1 CompareFaces** — not 1:N search. `FACE_PROVIDER=stub`
   until there is an AWS account. No embeddings or image bytes in the DB, only
   an S3 key. **No liveness in v1, deliberately** — `CompareFaces` answers "same
   face", never "live person", so a photo of the right person held to the camera
   passes and is *expected* to. Device binding plus the geofence narrow that to
   co-operative buddy punching on the victim's own handset, inside the office;
   at seven people that is accepted and every selfie is stored, so it is
   visible after the fact. Do not add a test asserting a held-up photo is
   refused — it cannot pass. See DECISIONS.md 007.
3. **Local files, no server.** SQLite at `data/boxcode.db`, photos in
   `data/uploads/`. Column types are dialect-portable (`app/db/types.py`), so
   Postgres is one connection string, not a rewrite.
4. **"Office only" needs WiFi, not GPS.** Three policies in
   `app/services/geofence.py`; currently `WIFI_OR_GPS`, switch to
   `WIFI_REQUIRED` after the pilot. See the long comment there for why a tight
   radius is the wrong answer.

## Traps that already bit us

- **Server time, never phone time.** The punch endpoint stamps with its own
  clock — a phone's clock is attacker-controlled. Demo scripts therefore cannot
  backdate over HTTP and use the service layer instead.
- **Night shifts.** `cutover_hour` must sit AFTER the shift ends or punch-outs
  file against the wrong day. It is now derived from the shift end and
  self-corrects. Ritesh (BX007) is on nights specifically to exercise this.
- **Nobody is absent until their shift has ended.** Otherwise the whole company
  reads absent at 10am and future dates are a wall of red.
- **Format times in the ORG's timezone**, never the server's.
- **SQLite journal mode** is PERSIST with a MEMORY fallback: the default deletes
  a file per commit, which some mounted filesystems refuse, surfacing as an
  unhelpful "disk I/O error".
- **`next/font` fetches at BUILD time** — it breaks builds on machines without
  Google Fonts access. Fonts are loaded via `<link>` in `app/layout.tsx` instead.
- **The dependency pins needed Python 3.14 versions.** The original pins were
  from late 2024 and `pip install` died compiling `pydantic-core`: its bundled
  PyO3 refuses any interpreter newer than 3.13. If you see a Rust build error,
  the pin is too old for the interpreter, not the other way round.
- **Never rename a venv directory.** The console scripts in `.venv/bin` carry
  an absolute shebang, so a renamed venv gives `uvicorn: command not found`
  (exit 127) while `.venv/bin/python -m uvicorn` still works. Delete and
  recreate instead.
- **`run.sh` traps EXIT with `kill 0`.** Killing one of its children takes the
  whole stack down with it, dashboard included. Restart with `./run.sh` rather
  than trying to revive half of it.
- **The dashboard's gateway must export every HTTP method it forwards.** A
  missing `export async function PUT` in `app/api/gateway/[...path]/route.ts`
  gives a 405 that looks like an auth failure. Next also caches a route's
  method map in dev - after adding one, restart rather than trusting HMR.
- **Adding a leave type or holiday changes attendance.** Anything that touches
  `holidays` or an approved `leave_requests` row must recompute the affected
  dates, or the board keeps showing the old answer.
- **Next 16 renamed `middleware.ts` to `proxy.ts`.** Do not confuse the root
  `proxy.ts` (auth redirect + token refresh) with `app/api/gateway`, which is
  the pass-through browser code uses to reach the API.
- **A 403 is not "the API is down".** `apiFetch` in `apps/web/lib/session.ts`
  reports WHY a call failed. Collapsing them into `null` is how an employee got
  told the server was broken when the page simply was not theirs.
- **`lib/format.ts` vs `lib/api.ts`.** Client components may only import the
  former; `lib/api.ts` reads cookies via `next/headers` and cannot be bundled
  into browser code.
- **bcrypt hashes a SHA-256 digest, not the raw password** (`app/core/security.py`).
  bcrypt ignores everything past 72 bytes; digesting first covers any length.
- **Schema changes go through Alembic now, not `create_all`.** After editing a
  model: `.venv/bin/alembic revision --autogenerate -m "what changed"`, read
  the generated file, then `scripts/init_db.py`. Skipping this leaves the
  column missing on every database that already exists, and the failure shows
  up as a confusing query error rather than at setup.
- **A database from before migrations is adopted, not rebuilt.** `init_db.py`
  detects tables with no `alembic_version` and stamps them at the baseline.
  That is why the pilot's punches do not have to be thrown away to gain a
  version table.
- **`node_modules` and `.venv` are platform-specific.** Installing them from one
  machine and running on another fails with native-module errors. `run.sh`
  detects this and rebuilds.

## Status

Working: punch → verify → store → resolve → HR dashboard, face enrolment, auth,
and leave. Mobile app runs in Expo Go. All tests pass.

**Photo retention is enforced, not just promised.** `scripts/purge_photos.py`
deletes punch selfies past `PUNCH_SELFIE_RETENTION_DAYS` (90) and reference
photos belonging to people who left more than
`REFERENCE_PHOTO_DAYS_AFTER_EXIT` (30) days ago. Dry run by default; `--apply`
to actually delete. Put it on cron in production.

- **It deletes FILES, never rows.** `punch_events` stays append-only - the
  punch, its verdict and its rejection reason all survive, and `photo_key`
  remains as the record that an image existed. Readers already tolerate a
  missing file.
- **Every sweep writes an audit row**, because "where did that photo go" needs
  an answer better than "we think a cron ate it".

**The schema is managed by Alembic.** `scripts/init_db.py` runs
`alembic upgrade head` rather than `create_all`, in development too - so the
upgrade path is exercised daily by the people who can fix it, instead of being
tried for the first time against real attendance data. `tests/test_migrations.py`
proves a migrated database matches the models exactly, that migrations reverse
cleanly, and that a pre-migration database keeps its rows.

**Offline punches are really queued now.** The app used to say "saved on your
phone and will sync automatically" while persisting nothing - the punch, the
selfie and the GPS reading were all discarded and the person was marked absent
for a day they worked. `src/queue.ts` writes the photo and the metadata to the
document directory (NOT the camera cache, which the OS may empty), and
`src/sync.ts` drains it on launch, on foreground, and after any successful
punch.

- **`captured_at` is the one client-supplied time the server accepts**, and it
  is bounded, not trusted: absent means server time as before, a future time
  means the phone's clock is wrong so server time is used and noted, and
  anything older than `MAX_QUEUED_PUNCH_HOURS` (48) is refused with a reason.
- **`shift_date` follows `event_ts`, not the clock**, or a 23:50 punch that
  syncs after midnight files against the wrong day.
- **The dual clock finally does its job.** `event_ts_utc` is when it happened,
  `received_ts_utc` is when we got it; a late sync records both instead of
  pretending someone arrived two hours late.
- **Retrying is idempotent** - dedupe is per identity per second, so the same
  queued punch sent twice is one row. A punch refused for good (too old) is
  dropped from the queue WITH its reason shown, never silently.

**Month-end export is built.** `GET /admin/export/month.csv` returns the
attendance register - one row per employee, one column per day, coded
P/HD/A/L/WO/PH - plus totals, hours, late and OT. There is a download button on
the board that exports the month you are looking at, not always the current one.

- **CSV, not .xlsx, deliberately.** Excel opens it, it needs no dependency, and
  unlike a binary workbook it can be diffed and grepped. Revisit only if HR
  asks for formatting.
- **Recomputed at export time**, like the board, so the document someone gets
  paid from cannot disagree with the punches behind it.
- **`days_payable` is the only payroll-shaped opinion in the file** and it
  states its own formula in the CSV header. Unpaid (LOP) leave is broken out
  separately so payroll can apply a different rule.

**Leave is built, and it is wired into attendance.** That wiring was the point:
`recompute_day()` now looks up approved leave and holidays and passes
`is_holiday` / `leave_fraction` into `resolve_day()`. Before this, both read as
"absent" no matter what HR approved.

- **Approving or cancelling recomputes every affected day inside the service
  call** (`decide()` / `cancel()` in `app/services/leave.py`), not in the route.
  A route that forgets to recompute leaves the board contradicting the
  approval, so it must not be possible to forget.
- **Adding or removing a holiday recomputes those dates for everyone**, for the
  same reason.
- **A punch on an approved leave day is flagged, never swallowed.** The day
  stays `on_leave`, gets `has_exception`, and HR decides which fact was the
  mistake. The leave is not auto-cancelled and the punch is not dropped.
- **Half a day of leave plus half a day worked is a full day**, not an absence.
- **HR owns the policy** at `/leave/policy` (hr_admin only): leave year, quotas,
  accrual, carry-forward and cap, sandwich rule, backdating window, and the
  holiday calendar. Nothing lives in a config file.
- **A policy change never rewrites history.** Editing a quota applies from the
  next accrual run; balances already accrued are untouched, the page says so
  before saving, and every edit writes an audit row with old and new values.
- **Accrual is idempotent.** `leave_accrual_runs` has a unique key per
  employee/type/period/month, so running the job twice is a no-op. Never derive
  "what should they have by now" from the current quota - that silently
  rewrites history the moment a quota changes.
- Approvals are scoped: a manager decides for their reports, HR for everyone,
  and **nobody decides their own leave, admin included**.

Defaults shipped for Krish to confirm: Jan-Dec leave year; CL 12, SL 6, EL 15
(carries forward, cap 30), LOP unlimited unpaid; sandwich rule OFF; backdating
7 days.

**The holiday dates need checking.** 2026 is seeded with India's national
holidays plus Gujarat's. The fixed-date ones are reliable; the 16 lunar-calendar
festivals (Holi, both Eids, Janmashtami, Diwali, and the rest) are seeded from a
best estimate and marked `is_confirmed=False`, which shows as "Check date" in
the dashboard. They are fixed by state notification, not arithmetic. A wrong
holiday marks the whole company off on the wrong day.

Not built yet, in priority order:
1. **Correction workflow** - the PRD (section 11) wants employee requests ->
   manager approves -> day recomputes, with a `correction_requests` table and
   Draft/Pending/Approved/Rejected/Cancelled states. What exists is
   `POST /admin/correct`: HR-only, direct, no UI.
2. **Notifications** - the expanded PRD lists six (correction submitted /
   approved / rejected, missing punch-out, late threshold, invite). None are
   built; `MobileDevice.push_token` is a column nothing ever writes to.
3. **Carry-forward at year end** - the flags and the cap are stored and
   editable, but nothing yet runs the roll-over that moves EL into next year's
   `opening` and lapses CL/SL.
4. **Manager relationships** - `manager_id` exists and the scoping works
   (`visible_employees`), but the seed sets nobody's manager, so no one is a
   manager in practice.
5. **A "Check in" entry point on the dashboard**, so an admin can mark their own
   attendance without reaching for their phone.
6. Then payroll (India: PF, ESI, PT, TDS, Form 16).

## Still outstanding from Krish

- Real office coordinates. The current lat/lng is a map pin, not a measurement.
  The **Survey** tab in the mobile app records real readings — walk the
  building, tap Desk / Reception / Gate / Car park, send the numbers.
- Office WiFi BSSID, for `WIFI_REQUIRED`.
- Whether the team is mostly iPhone (reading BSSID on iOS needs an Apple
  entitlement; the network *name* alone is not enough — anyone can name a
  hotspot "Boxcode-Office"). Apple review takes weeks, so this one is on the
  critical path even though it looks like a detail.
- **For a real deployment** (the PRD's own blocking list): an EC2 host with SSH
  user and key, a domain pointing at it (iOS refuses plain HTTP, so TLS is a
  prerequisite not polish), the employee list as CSV, and the real shift
  timings and week-offs. None of these block local development.

## Conventions

- Comments explain WHY, not what. Especially where a decision looks odd.
- Every mutation should write an audit row; nothing is hard-deleted
  (`deleted_at` everywhere).
- Status is never conveyed by colour alone — always a word and a glyph too.
- Docs live in `docs/`: PLAN.md (architecture), PRD.md (scope and milestones),
  DECISIONS.md (why), AWS-CREDENTIALS.md (what the app may and may not hold).
