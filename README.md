# Boxcode HRMS

Attendance-first HR platform for Boxcode. India. Under 60 employees, one office.

Capture is the **mobile app**: GPS geofence + face match. No gate hardware -
that decision was made deliberately (see docs/DECISIONS.md).

## Where things are

    apps/api          FastAPI backend
      app/models      SQLAlchemy tables (org, employee, device, attendance)
      app/services    resolver.py  <- the attendance brain, pure & unit-tested
      app/api/routes  ingest.py    <- generic punch API + ZKTeco/eSSL ADMS adapter
      tests           run with plain python3, no pytest needed
    apps/web          Next.js admin dashboard - live board, exceptions, month view
      app/adapters    zkteco_adms.py <- PARKED gate-reader adapter, kept not wired
    apps/mobile       Expo app - the punch screen (runs on mock data today)
    infra/            ec2-setup.sh <- one-time server provisioning
    tools/simulator   fake_gate.py <- parked along with the hardware path
    docs/PLAN.md      the build plan

## Status

Working end to end today, on a laptop, with no infrastructure:

- punch arrives -> verified (presence, then face) -> stored -> resolved into a day
- rejected punches are stored too, with their reason, and excluded from hours
- duplicates and retries cannot double-count
- mobile app runs on a phone via Expo Go against mock data

## The one rule

Every capture method - gate reader, mobile app, kiosk, HR manual entry -
produces the SAME normalized punch event. Adapters translate. The core is
vendor-neutral. Swap the hardware, nothing downstream changes.

    capture -> punch_events (append-only, idempotent) -> resolver -> attendance_day

`punch_events` is never updated or deleted. `attendance_day` is derived and can
be thrown away and recomputed at any time.

## Run the tests (works right now, no database, no AWS)

    cd apps/api
    python3 tests/test_resolver.py     # shift logic, night shifts, exceptions
    python3 tests/test_geofence.py     # distance, spoofing, bad GPS

## Requirements

- **Python 3.10 or newer.** macOS ships 3.9 with the developer tools; it is end
  of life and does not support the type syntax this codebase uses. `brew install
  python@3.12`, or grab the installer from python.org. `run.sh` finds the newest
  one on the machine automatically - you do not need to change your default.
- **Node 20 or newer** for the dashboard and the mobile app.

## Run everything

    ./run.sh              dashboard on :3000, API on :8000
    ./run.sh --lan        also reachable from your phone
    ./run.sh --clean      force a full dependency reinstall

First run installs dependencies and seeds the database. Then open
http://localhost:3000.

### "Cannot find module '../lightningcss.darwin-arm64.node'"

`node_modules` and the Python venv hold compiled binaries for ONE operating
system and CPU. If a checkout is copied between machines - or the dependencies
were installed from a different machine over a mounted share - they break like
this. The source code is fine; only the installed dependencies are wrong.

`./run.sh` detects it and rebuilds automatically. To force it:

    ./fix-deps.sh

That deletes every installed dependency and reinstalls for the current machine.
Your database and photos in `data/` are untouched.

## Run the API on its own (no server, no database install, no AWS account)

    cd apps/api
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/python scripts/init_db.py     # creates ../../data/boxcode.db
    .venv/bin/python scripts/seed.py        # org, office, 2 shifts, 12 staff
    .venv/bin/python scripts/demo_day.py    # proves the whole thing works
    .venv/bin/uvicorn app.main:app --reload # http://localhost:8000/docs

Everything is stored in `data/` at the repo root - a SQLite file plus the punch
photos. See `data/README.md`.

Moving to Postgres later is one connection string: the models use
dialect-portable column types, so nothing above the database layer changes.

## Run the mobile app (works right now, no server needed)

    cd apps/mobile
    npx expo start

Scan the QR code with Expo Go on your phone. Two tabs: **Check in** and
**Survey**. The survey tab is a setup tool - see below - and comes out before
the pilot. `USE_MOCK = true` in src/api.ts
means it talks to a fake server that returns the same shapes the real API will,
including every rejection path.

The dashed DEMO panel at the bottom of the screen forces any outcome - too far,
faked GPS, wrong WiFi, face mismatch, no signal - so you can show HR what each
failure looks like without driving to the car park. Delete that panel before
the pilot.

### Set the real office coordinates

Open the **Survey** tab and walk the building: desk, reception, gate, car park.
Tap each spot once the accuracy figure settles. It shows live GPS, distance
from the current pin, and an averaged office centre from the indoor readings.

Send those numbers over and they replace the provisional pin in
`apps/api/app/core/office.py` and `apps/mobile/src/geo.ts`. A map pin can sit
100m from the building you actually work in, and 100m is most of a geofence.

If no radius both admits every desk and excludes the car park, that is the
finding: GPS alone won't work here and we go `wifi_required`.

### Punch from your actual phone into the actual database

1. Find your laptop's LAN address: `ipconfig getifaddr en0`
2. In `apps/mobile/src/api.ts` set `USE_MOCK = false` and put that address in
   `API_BASE` (localhost on a phone means the phone, not your laptop)
3. Start the API bound to all interfaces:
   `cd apps/api && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000`
4. Phone and laptop on the same WiFi, then punch

The punch lands in `data/boxcode.db` and the selfie in `data/uploads/punches/`.
`EMPLOYEE_CODE` in api.ts picks who you are until login exists.

## Pretend a gate device exists

    python3 tools/simulator/fake_gate.py --day 2026-08-24 --staff 8
    python3 tools/simulator/fake_gate.py --replay-outage   # tests idempotency
    python3 tools/simulator/fake_gate.py --live
