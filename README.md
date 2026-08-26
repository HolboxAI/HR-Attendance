# Boxcode HRMS

Attendance-first HR platform for Boxcode. India. One gate location today.

## Where things are

    apps/api          FastAPI backend
      app/models      SQLAlchemy tables (org, employee, device, attendance)
      app/services    resolver.py  <- the attendance brain, pure & unit-tested
      app/api/routes  ingest.py    <- generic punch API + ZKTeco/eSSL ADMS adapter
      tests           run with plain python3, no pytest needed
    apps/web          Next.js (not scaffolded yet)
    tools/simulator   fake_gate.py <- a gate reader that doesn't exist yet
    docs/PLAN.md      the build plan

## The one rule

Every capture method - gate reader, mobile app, kiosk, HR manual entry -
produces the SAME normalized punch event. Adapters translate. The core is
vendor-neutral. Swap the hardware, nothing downstream changes.

    capture -> punch_events (append-only, idempotent) -> resolver -> attendance_day

`punch_events` is never updated or deleted. `attendance_day` is derived and can
be thrown away and recomputed at any time.

## Run the tests (works right now, no database needed)

    cd apps/api && python3 tests/test_resolver.py

## Run the API (needs a Postgres URL in .env)

    cd apps/api
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env        # then set DATABASE_URL
    uvicorn app.main:app --reload

## Pretend a gate device exists

    python3 tools/simulator/fake_gate.py --day 2026-08-24 --staff 8
    python3 tools/simulator/fake_gate.py --replay-outage   # tests idempotency
    python3 tools/simulator/fake_gate.py --live
