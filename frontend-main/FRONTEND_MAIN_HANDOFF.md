# Boxcode HRMS — Frontend Main Handoff

## 1. Executive summary

`frontend-main/` is a complete replacement frontend for Boxcode HRMS - web
dashboard and employee mobile app - built against the existing backend
(`apps/api`), which was not touched. It preserves the three things that must
not regress (the approved web sign-in page, the httpOnly-cookie auth
architecture, and the mobile offline punch queue), removes mobile mock mode
entirely, and adds every screen the backend could already serve but nothing
displayed: employee profiles, a people directory, devices with unbind,
team balances, leave accrual/carry-forward, the leave audit, a full
notifications page, employee-facing corrections on web, and mobile month /
corrections / inbox / set-password. The original `apps/web` and `apps/mobile`
are intact; replacement is a deliberate, later step (§18).

## 2. Final folder structure

    frontend-main/
    ├── web/                        Next.js 16 dashboard (same stack as apps/web)
    │   ├── app/
    │   │   ├── (auth)/login/       approved sign-in — copied verbatim
    │   │   ├── (dashboard)/        overview, board, corrections, devices,
    │   │   │                       enrolment, leave{,/policy,/balances,
    │   │   │                       /operations,/audit}, month/[code],
    │   │   │                       notifications, people{,/[code]}, loading
    │   │   ├── api/session/        cookie login/logout   (preserved)
    │   │   ├── api/gateway/        token pass-through    (preserved)
    │   │   ├── layout.tsx          fonts via <link>, theme-init script
    │   │   └── globals.css         design system
    │   ├── components/             33 components (ui/ = sign-in kit, verbatim)
    │   ├── lib/                    session.ts · api.ts · format.ts · capabilities.ts
    │   └── proxy.ts                middleware auth+refresh (preserved)
    ├── mobile/                     Expo 57 app (same pins as apps/mobile)
    │   ├── App.tsx                 5 tabs, session restore, queue flush
    │   └── src/                    config, api (real only), session/auth,
    │                               queue+sync (preserved), format, theme,
    │                               Punch/Month/Corrections/Leave/Inbox/
    │                               Profile/Login/Survey screens
    ├── shared/
    │   ├── design-tokens/tokens.json
    │   └── domain-types/README.md  why types are per-client, not a package
    ├── docs/                       DESIGN_SYSTEM · WEB_ARCHITECTURE ·
    │                               MOBILE_ARCHITECTURE · API_INTEGRATION ·
    │                               ROLE_MATRIX
    └── FRONTEND_MAIN_HANDOFF.md    this file

## 3. Web application

Status legend: **NEW** built in this pass · **REDESIGNED** existed, rebuilt ·
**PRESERVED** copied deliberately unchanged.

| Route | Role | Status | API | Main components |
|---|---|---|---|---|
| `/login` | public | PRESERVED | POST /api/session → auth/login | ui/auth-page, hero-shutter-text |
| `/` | all (adapts) | REDESIGNED | admin/board, admin/leave/pending, admin/corrections/pending, admin/enrolments, admin/rejected, admin/holidays; employees: mobile/month | MetricTile, AttendancePulse, MyMonth |
| `/board` | manager+ | REDESIGNED | admin/board?on=, admin/rejected, export/month.csv | Tiles, BoardToolbar, BoardTable |
| `/month/[code]` | manager+ | REDESIGNED (adds month nav, links to profile) | admin/month | — |
| `/people` | manager+ | NEW | admin/board + admin/enrolments + admin/devices | Directory |
| `/people/[code]` | manager+ | NEW | admin/board, admin/month, admin/enrolments, admin/devices, admin/corrections/pending, admin/leave/balances, admin/rejected | MonthCalendar, Avatar, Status |
| `/corrections` | all (adapts) | REDESIGNED + NEW | corrections (submit/mine/cancel); HR: admin/corrections pending+decide, admin/correct, admin/board | PendingCorrections, AddPunch, MyCorrections |
| `/leave` | all (adapts) | REDESIGNED (adds sub-page links) | leave/*, admin/leave/pending+decide, admin/holidays | MyLeave, PendingLeave, HolidayCalendar |
| `/leave/policy` | hr_admin+ | PRESERVED (stale copy fixed) | admin/leave policy/types/audit, holidays | PolicyEditor, HolidayCalendar |
| `/leave/balances` | manager+ | NEW | admin/leave/balances | — (pivot table) |
| `/leave/operations` | hr_admin+ | NEW | admin/leave/accrue, admin/leave/carry-forward | LeaveOperations, ConfirmDialog |
| `/leave/audit` | hr_admin+ | NEW | admin/leave/audit | — (old→new change list) |
| `/enrolment` | hr_admin+ | PRESERVED | admin/enrolments (+photo, delete) | EnrolmentTable |
| `/devices` | hr_admin+ | NEW | admin/devices GET + **DELETE (unbind)** | DeviceList, ConfirmDialog |
| `/notifications` | all | NEW | notifications list/read | NotificationsPage |

Shell (all signed-in routes): role-aware sidebar (drawer <lg), glass topbar,
NotificationBell (live unread, dropdown, View all), light/dark/system
ThemeToggle with no-flash init, route-level loading skeletons.

## 4. Mobile application

| Screen | Purpose | API | Offline behaviour | Permissions |
|---|---|---|---|---|
| Login (REDESIGNED §6.2) | sign in, registers handset | auth/login (+install_id) | error says "check the WiFi" | — |
| Home / Punch (kept, de-mocked) | THE screen: one dominant Check In/Out, today, results | mobile/me, mobile/punch | full queue: enqueue on failure, "saved, not checked in", pending banner + Try now, drains on launch/foreground/success | camera+location; denied ≠ unavailable, Open Settings |
| Month (NEW) | day-by-day month, totals, day detail, month nav | mobile/month | pull-to-refresh; load error + retry | — |
| Corrections (NEW) | submit claimed time + reason, list, withdraw; prefilled from a flagged day | corrections submit/mine/cancel | API refusals shown verbatim | — |
| Leave (kept, de-mocked) | balances, apply, cancel | leave/* | errors shown, no fake success | — |
| Inbox (NEW) | notification records + mark read, tab badge | notifications | pull-to-refresh | — |
| Profile (NEW) | identity, set password, Survey, sign out | auth/set-password | — | — |
| Survey (PRESERVED) | record real office GPS readings | local only | — | location |

Removed on purpose: `USE_MOCK` and the whole mock backend, the hardcoded LAN
IP, the demo "force a result" panel (it only ever worked against the mock).

## 5. Design system

See docs/DESIGN_SYSTEM.md. In one paragraph: amber-on-graphite identity from
the approved sign-in; dashboard defaults light with a true dark theme and
system mode (persisted, applied before first paint); tokens shared via
shared/design-tokens/tokens.json; glass reserved for floating chrome; status
is always word + glyph, never colour alone; motion is compositor-only, subtle
(staggered card rise, count-up numbers, presence pulse, skeleton shimmer) and
fully disabled under prefers-reduced-motion; responsive from wide desktop to
phone width (sidebar→drawer, tables→cards, 5→2 column grids).

## 6. Role matrix

See docs/ROLE_MATRIX.md. Summary: capabilities derive from the stacking role
rank in one file (web/lib/capabilities.ts); super admin and HR admin are
identical **because their API access is identical today** (verified: no
endpoint requires super_admin); the manager tier is dormant but fully wired;
employees get their own month, leave, corrections, notifications and friendly
403s everywhere else; nobody ever sees an approve control on their own leave.

## 7. API integration

See docs/API_INTEGRATION.md for the full endpoint→screen map. Every endpoint
in the backend has a frontend surface except `POST /ingest/punch` (parked gate
hardware, closed by default) and `POST /auth/refresh`/`logout` which are
plumbing. No endpoint names were invented; no client-side attendance logic
duplicates the resolver.

## 8. Existing backend behaviour the frontend relies on

- Board/month/export are recomputed from punches per request - never cached
  client-side beyond the page render.
- Approving leave/corrections recomputes affected days inside the service
  call, so the UI only needs `router.refresh()`.
- `/admin/leave/pending` filters out your own request (self-approval).
- Accrual and carry-forward are idempotent; the UI says so and shows
  credited/skipped from the response.
- Punch dedupe is per identity per second (safe queue retries).
- `captured_at` on a queued punch is bounded, not trusted; 422 means dropped
  for good, with reason.
- 404-not-403 for out-of-scope employees (no enumeration).

## 9. Existing functionality preserved

- **Web sign-in page** - byte-for-byte (page, ui components, animation CSS).
- **Auth architecture** - httpOnly cookies, proxy.ts refresh, /api/gateway,
  /api/session; page JS still can never read a token.
- **Offline queue** - queue.ts/sync.ts copied unchanged; PunchScreen still
  enqueues with capturedAt, flush on launch/foreground/success.
- **Device binding** - X-Install-Id header, install id survives sign-out.
- **Survey tool**, geofence haversine, IST rendering, status glyph discipline.
- **Enrolment and leave-policy screens** - already built and approved.

## 10. New frontend functionality added

**Redesigned:** dashboard, board (links to profiles), month page, leave page,
corrections, mobile login, mobile punch polish.
**Newly implemented:** people directory, employee profile, devices (+unbind),
team balances, accrual & carry-forward UI, leave audit, notifications page,
employee corrections (web), mobile month/corrections/inbox/profile/set-password,
theme system, capability model, error/empty/loading vocabulary.
**Preserved:** §9. **Blocked:** §11.

## 11. Features blocked by backend

| Feature | Reason | Missing | Frontend prep |
|---|---|---|---|
| Office & presence policy admin | no route | GET/PUT /admin/locations (logic exists in geofence.py) | sidebar section slot; page is a day's work once the API lands |
| Roles & access admin | no route | PUT /admin/users/{id}/role | capability model already central |
| Global audit log | leave-scoped only | general audit route | /leave/audit sets the rendering pattern (old→new) |
| Security settings | nothing | all | — |
| Create employee / invite | seed scripts only | POST /admin/employees | directory copy states it plainly |
| Shift assignment | model only | management route | profile shows shift read-only |
| Admin browser check-in | needs a binding policy decision | — | deliberately no button |
| Push delivery | PUSH_PROVIDER=null, no devices | Expo token + wiring | UI never implies push works |

Unblocked during audit: device **unbind** exists (`DELETE /admin/devices/{code}`)
and is built, despite the PRD listing it 🔴.

## 12. Environment variables (names only)

Web: `NEXT_PUBLIC_API`. Mobile: `EXPO_PUBLIC_API_BASE` (see mobile/.env.example).

## 13. How to run web

    cd apps/api && .venv/bin/uvicorn app.main:app --reload   # or ./run.sh
    cd frontend-main/web
    npm install
    npm run dev            # http://localhost:3000  (or: next dev --port 3100)

## 14. How to run mobile

    cd frontend-main/mobile
    cp .env.example .env   # set EXPO_PUBLIC_API_BASE to your laptop's LAN IP
    npm install
    npm start              # scan with Expo Go; API must run with --lan/0.0.0.0

## 15. Typecheck / lint / build

    cd frontend-main/web    && npx tsc --noEmit && npm run build
    cd frontend-main/mobile && npx tsc --noEmit && npx expo export --platform ios

(No eslint config exists in either original app; none was added.)

## 16. Known issues

- Employee-profile leave balances render only after accrual has been run for
  the period (the API returns no rows before that); the balances page links to
  /leave/operations for exactly this case.
- "Mark all read" on /notifications loops per-row - there is no bulk endpoint.
- The employee correction form asks for date+time inputs; the flagged-day
  shortcut prefis them, but a fully guided evidence view (photos of the day's
  punches) would need punch-level detail the API does not expose per-employee.
- Mobile has not run on a physical handset (matches repo status - deferred by
  Krish's call); verified via typecheck + Hermes bundle export only.
- `web/.env.local` may exist from this session's verification pointing at a
  throwaway API on :8001 - delete it (documented below) for real use.

## 17. Remaining work

- Real-device mobile pass (camera/GPS/queue on hardware).
- Wire the §11 items as their APIs appear.
- Web set-password flow (endpoint exists; mobile has it, web doesn't yet).
- Consider a generated OpenAPI client if a third consumer appears.

## 18. Replacement instructions

`apps/api` needs nothing. When ready to replace the old frontends:

1. `git mv apps/web apps/web-old && git mv frontend-main/web apps/web`
   (or copy contents; `.env`/ports carry over - the app is drop-in: same
   routes, same auth files, same run.sh expectations).
2. Same for `apps/mobile` ← `frontend-main/mobile` (bring `.env`).
3. Run the checks in §15 plus `apps/api`'s own test suite; nothing in the API
   changed, so failures would be environmental.
4. Delete `apps/*-old` once the pilot is happy. Until then both trees coexist;
   nothing imports across them.

## 19. Git handoff

Intended branch: `frontend-main`. Commit the whole `frontend-main/` directory
(node_modules and .next are covered by the copied .gitignore files) plus, if
wanted, `.claude/launch.json`'s added dev-server entry. Nothing under `apps/`
or `data/` belongs in this commit.

## 20. Final verification checklist

- [x] `web`: tsc clean; production build clean (16 routes, middleware compiled)
- [x] `mobile`: tsc clean; `expo export` produced a Hermes bundle
- [x] Signed in against a real (throwaway, seeded) API as super_admin and as
      an employee via the preserved sign-in page
- [x] Dashboard tiles/pulse driven by real punches (3 in-office, 3 late, refused punch)
- [x] Correction round-trip: employee submit over HTTP → pending queue →
      approve in UI → queue empties, day recomputed, notification row fired
- [x] Leave round-trip: seed types + accrual over API → balances on /leave,
      approver queue shows the request, /leave/balances pivots correctly
- [x] Devices page lists real bindings from mobile-style logins; unbind wired
      to the real DELETE (confirm dialog states sessions are signed out)
- [x] Role scoping: employee direct-URL to /devices → "managed by HR
      administrators", not an error; employee sidebar shows only their items
- [x] Dark mode toggle + persistence + no-flash init; light default
- [x] Mobile-width layout: drawer nav, 2-col tiles, card lists
- [x] No mock data anywhere; no invented endpoints (checked against routes/)
- [ ] Physical handset test - out of scope by existing project decision
