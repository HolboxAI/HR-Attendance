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
    apps/api/.venv/bin/python apps/api/scripts/demo_day.py       # end-to-end
    cd apps/web && npx tsc --noEmit
    cd apps/mobile && npx tsc --noEmit

`demo_day.py` posts real punches through the real HTTP API and prints what HR
would see. It has caught three real bugs. Run it after touching attendance.

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

## Decisions already made (see docs/DECISIONS.md before revisiting)

1. **No gate hardware.** Mobile app only: GPS geofence + face match. The ZKTeco
   adapter is parked, intact and unwired, at `app/adapters/zkteco_adms.py`.
2. **AWS Rekognition, 1:1 CompareFaces** — not 1:N search. `FACE_PROVIDER=stub`
   until there is an AWS account. No embeddings or image bytes in the DB, only
   an S3 key.
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
- **`node_modules` and `.venv` are platform-specific.** Installing them from one
  machine and running on another fails with native-module errors. `run.sh`
  detects this and rebuilds.

## Status

Working: punch → verify → store → resolve → HR dashboard, and face enrolment.
Mobile app runs in Expo Go. All tests pass.

**Face enrolment is built** (`/enrolment` in the dashboard). HR adds, replaces
and withdraws one reference photo per person; the punch endpoint compares each
selfie against it. Nobody is enrolled yet, so read the next paragraph before
assuming the face check is doing anything.

`REQUIRE_FACE_ENROLMENT` (default `false`) decides what happens to someone with
no reference photo. While it is false they still punch, and the punch is stored
with `face_ok = NULL` and `raw_payload.face_checked = false` — never
`face_ok = true`. That distinction is the whole point: the database must not
claim a match against a photo that does not exist. Flip it to `true` once the
enrolment screen reads 100%, which is the moment the face check starts being
load-bearing. Note that `FACE_PROVIDER` is still `stub`, which accepts any
selfie that has *something* to compare against — it proves the plumbing, not
the person. Real matching needs an AWS account.

Not built yet, in priority order:
1. **Auth** — `EMPLOYEE_CODE` in `apps/mobile/src/api.ts` stands in for login.
   Anyone can edit it and punch as someone else. Must not survive the pilot.
   Note `passlib` is deliberately not a dependency; use `bcrypt` directly
   (see the comment in `apps/api/requirements.txt`).
2. **Enrol from the mobile app** — HR currently uploads on the employee's
   behalf from the dashboard. Self-enrolment needs auth first, or anyone can
   enrol their own face as someone else's.
3. **Correction UI** — the API endpoint works; HR should not need curl.
4. Then leave, then payroll (India: PF, ESI, PT, TDS, Form 16).

Deliberately out of scope until attendance is closed end to end: payroll,
expenses, CRM, field tracking, tasks, liveness detection.

## Still outstanding from Krish

- Real office coordinates. The current lat/lng is a map pin, not a measurement.
  The **Survey** tab in the mobile app records real readings — walk the
  building, tap Desk / Reception / Gate / Car park, send the numbers.
- Office WiFi BSSID, for `WIFI_REQUIRED`.
- Whether the team is mostly iPhone (reading BSSID on iOS needs an Apple
  entitlement; the network *name* alone is not enough — anyone can name a
  hotspot "Boxcode-Office").

## Conventions

- Comments explain WHY, not what. Especially where a decision looks odd.
- Every mutation should write an audit row; nothing is hard-deleted
  (`deleted_at` everywhere).
- Status is never conveyed by colour alone — always a word and a glyph too.
- Docs live in `docs/`: PLAN.md (architecture), PRD.md (scope and milestones),
  DECISIONS.md (why), AWS-CREDENTIALS.md (what the app may and may not hold).
