# Boxcode HRMS — build plan

Full plan (diagrams, schema, module map): see the Claude artifact
https://claude.ai/code/artifact/8d56dd1b-feb7-418b-89ce-0975288057f1

## Stack (decided)
- Web:    Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- API:    FastAPI + Pydantic v2 + SQLAlchemy 2.0 + Alembic
- DB:     Postgres 16 (RLS multi-tenancy, monthly partitions on punch_events)
- Jobs:   Redis + Celery/ARQ
- Files:  S3 presigned
- Mobile: React Native (Expo)

## Core architectural rule
All attendance sources -> ONE normalized `punch_event`.
Adapters translate. The core never knows which device produced the punch.

    capture (gate push / gate pull / mobile / kiosk / manual)
        -> punch_events   [append-only, idempotent, dual clock]
        -> resolver       [pure fn: events + shift policy -> attendance_day]
        -> leave, payroll, dashboards, digests

Never edit raw events. Recompute attendance_day instead.

## Phases
1. Auth+org, employee directory, attendance, shifts/rosters, leave   (wk 1-5)
2. Payroll, expenses, documents                                      (wk 6-10)
3. Tasks/projects, CRM, field tracking, engagement                   (wk 11-16)

## Open questions
- [ ] Is Boxcode a platform we build on (there is a ~/.boxcode dir), or just the company name?
- [ ] Headcount + number of gate locations
- [ ] Internal tool only, or a product we may sell? (decides white-labelling now)
- [ ] Payroll jurisdiction: India (PF/ESI/PT/TDS) or US? Biggest scope variable.
- [ ] Gate device make + model -> which adapter gets written first

## Planned repo layout
    apps/web        Next.js
    apps/api        FastAPI
    apps/mobile     Expo
    packages/db     SQLAlchemy models + Alembic migrations
    packages/sdk    generated TS client from OpenAPI
    tools/simulator fake gate device -> lets us test attendance with no hardware
    infra/          docker-compose (dev), terraform (aws)
