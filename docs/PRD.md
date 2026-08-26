# PRD - Boxcode Attendance v1

Full version:
- Local copy: `docs/artifacts/attendance-prd.html` / `.txt`
- Live artifact: https://claude.ai/code/artifact/1a1a4060-e3d2-44b7-b641-3c2aeac33ce1

Architecture: docs/PLAN.md
Face check explained: `docs/artifacts/where-the-face-check-happens.html`

## Goal
Replace MyCo attendance for ~60 staff, one office, India. Attendance ONLY in v1.

## Success
- 100% of staff punching through our app by week 8
- <5% of days needing HR correction
- <8s from app open to confirmed punch
- ~0 false rejections at the desk (a wrongly-absent day is the failure that loses trust)
- Month-end report in one click

## "Office only"
GPS alone cannot do this. A radius tight enough to exclude the car park also
rejects people at their desks. So: office WiFi BSSID is the strong signal
(you must be associated to the AP = you are in the building), GPS is the
fallback. Three policies, per location, config not code:

  gps_only       radius alone (weakest)
  wifi_or_gps    either passes  <- START HERE
  wifi_required  must be on office WiFi  <- SWITCH AFTER PILOT

iOS caveat: reading BSSID needs an Apple entitlement. SSID alone is not enough
(anyone can name a hotspot "Boxcode-Office").

## Roles
employee (~60) | manager (~6) | hr_admin (1-2) | super_admin (1)

## Daily flow
1. Open app -> one button: Check In
2. Tap -> front camera only, no gallery; location captured in the same moment
3. Three checks, cheapest first: device binding -> presence -> face
4. Confirmation with time, or a reason they can act on. Both are recorded.
5. Resolver turns punches into attendance_day
6. HR sees live board + exception queue

## Milestones
M0 foundations                DONE (37 assertions passing, no DB, no AWS)
M1 database is real           week 1    postgres on EC2, auth, 60 employees loaded
M2 one person can punch       weeks 2-3 Expo app + face enrolment + real rows
M3 HR can run a month         week 4    live board, exceptions, corrections, export
M4 leave                      weeks 5-6 without it, holidays show as absent
M5 pilot with 5 people        week 7    dual-run vs MyCo, explain every mismatch
M6 everyone                   week 8    MyCo read-only 1 month, then off

## NOT in v1 (deliberately)
payroll, expenses, CRM, field tracking, tasks, liveness detection, gate
hardware, second office, web punch page. All start after M6.

## Non-negotiables
- No face embeddings or image bytes in the DB. S3 key only. Selfies deleted at 90 days.
- Postgres on localhost. SG opens 22 + 443 only.
- Real TLS on a real domain (iOS refuses plain HTTP).
- Audit row on every mutation. Nothing hard-deleted.
- Nightly pg_dump to S3, restore tested once before M6.
- API down -> app queues punches locally.

## Blocking me right now
- [ ] EC2 host, SSH user, key
- [ ] Office lat/lng
- [ ] Office WiFi BSSID          (by M2)
- [ ] Domain pointing at the EC2 (by M2)
- [ ] Employee list CSV          (by M1)
- [ ] Shift timings + week-offs  (by M1)
- [ ] iPhone or Android majority (by M2)
