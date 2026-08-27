# Boxcode HRMS — Frontend PRD

**Scope:** the admin web app (`apps/web`) and the employee mobile app
(`apps/mobile`). Backend is out of scope except where this document says a
screen needs an endpoint that does not exist yet — those are called out
explicitly rather than assumed.

**Not in scope:** the sign-in page. It is built, approved and committed
(`208ab8f`). Do not rebuild it. Both apps sign in through it.

**Status legend used throughout**

| Mark | Meaning |
|---|---|
| ✅ BUILT | Exists and works against the real API |
| 🟡 PARTIAL | Exists but incomplete, or built against mock data |
| 🔵 NEW | Backend endpoint exists, no UI yet — pure frontend work |
| 🔴 BLOCKED | No backend endpoint. Needs API work before the screen can be real |

---

## 1. Two findings that change the brief

### 1.1 Krish, Dhruv and Ashley cannot have different dashboards today

All three are `super_admin` (`scripts/seed_users.py`):

```
BX001 Krish   → super_admin
BX005 Dhruv   → super_admin
BX006 Ashley  → super_admin
BX008 Himesh  → hr_admin
everyone else → employee
```

Permissions in this system come from **role**, not from person. Three people
holding one role means one dashboard, rendered three times. Building three
visually different dashboards for identical permissions would be decoration
pretending to be access control.

**To genuinely differentiate them, pick one:**

- **(a) Keep one super-admin dashboard.** Simplest, matches the backend. Krish,
  Dhruv and Ashley see the same thing — which is correct, because they can *do*
  the same things.
- **(b) Demote Dhruv and Ashley to `hr_admin`.** Then Krish alone is
  `super_admin` and genuinely has more. One-line change in `seed_users.py`
  plus the section 1.2 work below.
- **(c) Give each a scope.** e.g. Ashley sees Operations only, Dhruv sees
  Design only, via `manager_id` reporting lines. This is the manager tier
  (§4.3), which already works — it just needs the roles reassigned.

**This PRD assumes (a) unless told otherwise**, and specifies the
super-admin-only screens so (b) becomes easy later.

### 1.2 `super_admin` has no exclusive powers today

Verified: **no endpoint anywhere requires `super_admin`.** Every gated route
tops out at `require_role(HR_ADMIN)`. So Himesh (hr_admin) and Krish
(super_admin) currently have *identical* API access.

The original PRD (§3) says super admin should own "locations, presence policy,
roles, security settings and audit log." None of those have endpoints. Section
5.1 lists them as 🔴 BLOCKED — they are what would make the super-admin
dashboard genuinely different, and they need backend work first.

---

## 2. The permission model (verified against `app/api/deps.py`)

Roles **stack**. Each level includes everything below it. Nobody needs two
roles.

```
employee (0)  <  manager (1)  <  hr_admin (2)  <  super_admin (3)
```

`visible_employees()` (`app/api/routes/admin.py:45`) is the single scoping rule:

- **manager** → their direct reports, plus themselves
- **hr_admin and above** → everyone

### 2.1 Capability matrix

| Capability | Employee | Manager | HR admin | Super admin | Endpoint gate |
|---|:--:|:--:|:--:|:--:|---|
| Punch in/out | ✔ | ✔ | ✔ | ✔ | `get_current_employee` |
| Own attendance month | ✔ | ✔ | ✔ | ✔ | `get_current_employee` |
| Own leave balance / apply / cancel | ✔ | ✔ | ✔ | ✔ | `get_current_employee` |
| Submit a correction request | ✔ | ✔ | ✔ | ✔ | `get_current_employee` |
| Own notifications | ✔ | ✔ | ✔ | ✔ | `get_current_user` |
| Attendance board | ✘ | scoped | all | all | `require_role(MANAGER)` |
| Anyone's month | ✘ | scoped | all | all | `require_role(MANAGER)` |
| Refused-punch log | ✘ | ✔ | ✔ | ✔ | `require_role(MANAGER)` |
| Month-end CSV export | ✘ | scoped | all | all | `require_role(MANAGER)` |
| Decide leave | ✘ | reports | all | all | `require_role(MANAGER)` + scope |
| Leave balances (others) | ✘ | scoped | all | all | `require_role(MANAGER)` |
| View holidays | ✘ | ✔ | ✔ | ✔ | `require_role(MANAGER)` |
| Decide corrections | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Add a punch directly | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Face enrolment | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Leave policy / types | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Run accrual / carry-forward | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Add a holiday | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Leave audit log | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |
| Device list | ✘ | ✘ | ✔ | ✔ | `require_role(HR_ADMIN)` |

**Two hard rules the UI must respect:**

1. **Nobody decides their own leave**, admin included. The API refuses
   (`app/services/leave.py:500`) and `/admin/leave/pending` already filters
   your own request out of your own queue. Never render an Approve button on
   your own request.
2. **The link is a courtesy, the API is the control.** Hiding a nav item is UX,
   not security. The API refuses regardless — so never rely on a hidden button
   to protect anything.

---

## 3. Web app — shared shell

✅ BUILT. Applies to every signed-in page.

- **Left sidebar**, grouped: Overview / Attendance / Leave / People. Items
  filter by role. Active item highlighted.
- **Topbar**: page context, notification bell (live, real unread count), user
  email + role badge, Sign out.
- **Theme**: light, white cards with soft shadows (`.bx-card`), scoped to the
  dashboard via `.bx-light` so the dark sign-in page is unaffected.
- **Layout**: `app/(dashboard)/layout.tsx`, max width 1180px.

### 3.1 Conventions every screen must follow

These are project rules, not preferences — see `CLAUDE.md`.

- **Status is never colour alone.** Always a word and a glyph too. A
  colourblind viewer, a greyscale printout and a screen reader all get the same
  information. Use `components/Status.tsx`.
- **Never say "the server is broken" for a 403.** `apiFetch` reports *why* a
  call failed. A forbidden page must say "this page is for HR", not "error".
- **Times render in the org's timezone** (Asia/Kolkata), never the server's.
- **Empty states say what would appear here**, not "no data".
- **Every destructive or approving action states its consequence** before it
  happens.

---

## 4. Web dashboards by role

### 4.1 Super admin — Krish, Dhruv, Ashley

Everything in §4.2 (HR admin), plus the super-admin-only section. Today that
section is entirely 🔴 BLOCKED — see §5.1. Until those endpoints exist, this
dashboard is **identical to HR admin**, and that is honest rather than a gap
to paper over.

### 4.2 HR admin — Himesh

Landing page `/` — ✅ BUILT. Tile grid, three groups:

- **Today's attendance** — In the office, Present, Late, Absent, On leave.
  Each links to `/board`.
- **Waiting on you** — Leave requests, Corrections, Needs attention,
  Refused punches. Live counts.
- **Manage** — Enrolment (missing-photo count), Leave policy, Export this month.

Full screen list in §5.

### 4.3 Manager — nobody holds this role today

The tier works — `visible_employees()` scopes the board, the month view, the
export and the leave queue to direct reports. It is dormant only because
every IC reports to Himesh, who is `hr_admin`.

**If activated**, a manager sees: `/`, `/board` (their reports only), `/leave`
(own + their reports' queue), `/month/[code]` for reports. They do **not** see
Corrections, Enrolment, Leave policy.

Build the UI role-aware now (it already is), and this tier costs nothing to
switch on later.

### 4.4 Employee — the other seven

Employees are **not** the audience for the web app (PRD §2.2 puts web punching
out of scope) but they can sign in, and must land somewhere useful rather than
on a 403.

- `/` → their own attendance month (✅ BUILT, `MyMonth`)
- `/leave` → own balance, apply, own requests (✅ BUILT)
- 🔵 `/corrections` → submit a correction against a flagged day (currently
  admin-only; needs an employee-facing submit view)
- No sidebar items for Board, Enrolment, Corrections queue, Policy.

---

## 5. Web screens — full specification

### 5.1 Super-admin only — 🔴 ALL BLOCKED

These are what make the super-admin dashboard different. Each needs an API
first.

| Screen | What it does | Needs |
|---|---|---|
| **Office & presence policy** | Set office lat/lng/radius, switch between `gps_only` / `wifi_or_gps` / `wifi_required`, register approved BSSIDs | `GET/PUT /admin/locations`. Logic exists in `app/services/geofence.py`; there is no route |
| **Roles & access** | Change a person's role, deactivate an account | `GET/PUT /admin/users/{id}/role`. Today only `seed_users.py` can |
| **Devices** | List bound handsets, unbind a lost phone | `GET /admin/devices` exists (hr_only) — **the list is 🔵, unbind is 🔴** |
| **Full audit log** | Every mutation, all entities | Only `GET /admin/leave/audit` exists — leave-scoped. Needs a general audit route |
| **Security settings** | Session lifetime, device-binding policy | 🔴 entirely |

> Recommendation: build **Devices (list)** first — it is the only one with a
> live endpoint, and "whose phone is bound" is a real support question today.

### 5.2 Attendance

| Route | Who | Status | Detail |
|---|---|---|---|
| `/` | manager+ | ✅ BUILT | Tile-grid overview |
| `/board` | manager+ | ✅ BUILT | `GET /admin/board?on=`. Live search (name/code/dept), status filter chips, avatars, presence dots, exceptions callout, refused-punch log, CSV export for the viewed month |
| `/month/[code]` | manager+ | ✅ BUILT | `GET /admin/month`. Per-employee month grid |
| `/corrections` | hr_admin+ | ✅ BUILT | `GET /admin/corrections/pending`, `POST /admin/corrections/{id}/decide`. Approve/reject with a required reason on reject |
| **Employee detail** | manager+ | 🔵 NEW | PRD §21.3 wants one page per person: profile, device state, enrolment status, shift, attendance calendar, source punches, corrections, leave, audit. Today `/month/[code]` covers only the calendar. **Compose from existing endpoints — no new API needed** |
| **Add punch directly** | hr_admin+ | 🔵 NEW | `POST /admin/correct` exists, no UI. For HR acting on a phone call |
| **Admin check-in** | any | 🔴 BLOCKED | Roadmap item 4. `POST /mobile/punch` requires `X-Install-Id` device binding — a browser has no handset binding, so this needs a deliberate policy decision, not just a button |

### 5.3 Leave

| Route | Who | Status | Detail |
|---|---|---|---|
| `/leave` | all | ✅ BUILT | Own balance + apply + own requests. Approver queue on top if `GET /admin/leave/pending` succeeds — **the page asks the API rather than guessing from role name** |
| `/leave/policy` | hr_admin+ | ✅ BUILT | Quotas, accrual, carry-forward, cap, sandwich rule, backdating, holiday calendar. Warns that changes never rewrite history |
| **Run accrual** | hr_admin+ | 🔵 NEW | `POST /admin/leave/accrue` exists, no button. Idempotent, so a double-click is safe — say so in the UI |
| **Run carry-forward** | hr_admin+ | 🔵 NEW | `POST /admin/leave/carry-forward?period=YYYY`. Year-boundary job, run by hand. Show `available_before_cap` vs `amount` so "why only 30, not 34" has an answer |
| **Team balances** | manager+ | 🔵 NEW | `GET /admin/leave/balances`, scoped. No UI |
| **Leave audit** | hr_admin+ | 🔵 NEW | `GET /admin/leave/audit`. Old and new values per change |

> **Holiday warning to surface in the UI:** 16 of 2026's lunar-calendar
> festivals are seeded from an estimate and flagged `is_confirmed=False`. The
> calendar already shows "Check date" — keep that. A wrong holiday marks the
> whole company off on the wrong day.

### 5.4 People

| Route | Who | Status | Detail |
|---|---|---|---|
| `/enrolment` | hr_admin+ | ✅ BUILT | `GET/POST /admin/enrolments`. Reference-photo capture, quality checks, append-only history |
| **Employee directory** | manager+ | 🔵 NEW | Scoped list. Compose from `/admin/board` rows |
| **Create employee + invite** | hr_admin+ | 🔴 BLOCKED | PRD §6.1. Today only `seed.py` creates people. Needs `POST /admin/employees` and an invite flow |
| **Shift assignment** | hr_admin+ | 🔴 BLOCKED | Shifts exist in the model, no management route |

### 5.5 Notifications

| Item | Status | Detail |
|---|---|---|
| Bell + unread badge + dropdown + mark-read | ✅ BUILT | `GET /notifications`, `/unread-count`, `POST /{id}/read` |
| **Full notifications page** | 🔵 NEW | The dropdown caps at 10. PRD §15: "every actionable item must remain visible inside the product" — that needs a full list, filterable by category |

Notifications fire today for: correction submitted / approved / rejected, leave
approved / rejected. The missing-punch-out nudge and late/absent threshold need
a scheduler, which does not exist yet — do not build UI implying they work.

---

## 6. Mobile app (`apps/mobile`)

Expo + React Native. **The employee product.** Per PRD §2.2, web punching is
explicitly out of scope — punching needs the front camera with no gallery
fallback, GPS with accuracy metadata, device binding and an offline queue that
survives restarts. A browser gives none of those reliably.

### 6.1 🟡 CRITICAL: the app runs on mock data

`src/api.ts` line 26:

```ts
export const USE_MOCK = true;
export const API_BASE = 'http://192.168.1.10:8000';
```

Every screen currently talks to an in-memory mock. **Wiring this to the real
API is the single highest-priority mobile task** — nothing else can be trusted
until it is done. `API_BASE` is also a hardcoded LAN IP that will not survive
leaving the office WiFi.

### 6.2 Sign-in — port the web design

Same credentials, same endpoint (`POST /auth/login`), no separate employee
login, no signup.

The web sign-in is a two-panel split: animated brand panel left, form right.
**On a phone the split does not apply** — the web version itself hides the left
panel below 1024px by design. Port it as:

- Boxcode lockup, centred, top
- "Welcome to" + **HOLBOX** with the shutter animation beneath it
- The form below: email, password, Sign in
- Google button: **omit on mobile.** It is disabled on web because there is no
  OAuth backend; shipping a dead button on a phone is worse
- Same honest footer: "There is no self-service signup — HR creates your
  account"

Use React Native `Animated`, not the web CSS keyframes. Keep the same rule the
web version learned the hard way: **the letters must never animate opacity** —
if the animation fails, you get a soft HOLBOX, never a blank screen.

### 6.3 Screens

| Screen | Status | Detail |
|---|---|---|
| **Login** | ✅ BUILT | Needs the §6.2 redesign |
| **Punch (home)** | ✅ BUILT | One dominant action: Check In or Check Out, whichever applies. Front camera only, no gallery. GPS + accuracy captured at the moment of the punch. Shows today's status, punches, shift, yesterday's hours. **Do not turn this into an HR dashboard** (PRD §7.1) |
| **Leave** | ✅ BUILT | Balance, apply, own requests, cancel |
| **Survey** | ✅ BUILT | Internal tool: walk the building tapping Desk / Reception / Gate / Car park to record real GPS readings. This is how the real office coordinates get measured |
| **My attendance month** | 🔵 NEW | `GET /mobile/month` exists, no screen. Employees can only see today |
| **Corrections** | 🔵 NEW | `POST /corrections`, `GET /corrections/my-requests`, `POST /{id}/cancel` all exist. PRD §11.2: open the affected day, see what is incomplete, submit a claimed time + reason. **This is the employee's only route out of a broken day** |
| **Notifications** | 🔵 NEW | `GET /notifications` + mark-read. Records exist; nothing displays them on mobile |
| **Set password** | 🔵 NEW | `POST /auth/set-password` exists. Needed so a new hire can replace the temporary password HR handed them |

### 6.4 Punch flow requirements (PRD §7.2, §20)

1. App determines whether a punch is available right now.
2. One tap on the primary button.
3. Front camera opens immediately.
4. Location and device evidence captured as close to the same moment as possible.
5. Server checks: device binding → office presence → face match. In that order,
   cheapest first.
6. Accepted **or rejected** punch is persisted — rejections are never dropped.
7. Resolver updates the derived day.
8. Clear confirmation, or an actionable reason.

**Result copy must be specific:**
- Success → "Checked in at 9:34 AM."
- Rejection → "You are about 400m from the office." Never just "Failed."
- Queued → "Punch saved and waiting for connection." Never claim "checked in"
  until the server accepts it.

### 6.5 Offline queue — ✅ BUILT, do not regress

`src/queue.ts` + `src/sync.ts`. The photo and metadata are written to the
**document directory**, not the camera cache, which the OS may empty. The queue
drains on launch, on foreground, and after any successful punch.

- `captured_at` is the one client-supplied time the server accepts, and it is
  bounded: absent → server time; future → phone clock is wrong, server time
  used and noted; older than 48h → refused with a reason.
- Retrying is idempotent — the same queued punch sent twice is one row.
- A punch refused for good is dropped from the queue **with its reason shown**,
  never silently.
- The UI must visibly distinguish **queued** from **confirmed**.

### 6.6 Permissions

Request camera and location with a plain explanation of why. If either is
denied, say exactly which capability is unavailable and how to turn it back on.
Handle "denied" and "unavailable" as different states.

---

## 7. Out of scope for v1

From the PRD's own non-goals — do not build nav items for these:

Payroll · Expenses · CRM · Task management · Field tracking · Gate hardware ·
Multiple offices · Browser-based employee punching · Passive liveness

A reference dashboard having these sections is not a reason to add them. A nav
link to a module with no backend is a worse empty state than a shorter sidebar.

---

## 8. Build order

**Web**

1. Devices list (only live super-admin-ish endpoint)
2. Employee detail page — composes existing endpoints, closes PRD §21.3
3. Accrual + carry-forward buttons — endpoints exist, HR needs them at year end
4. Full notifications page
5. Team balances, leave audit
6. Then the 🔴 backend-blocked items, once their APIs exist

**Mobile**

1. **Turn off `USE_MOCK` and wire the real API** — nothing else matters first
2. Sign-in redesign (§6.2)
3. Corrections screen — the employee's only route out of a broken day
4. My attendance month
5. Notifications
6. Set password

---

## 9. Open decisions for Krish

1. **§1.1** — one super-admin dashboard for all three of you, or reassign roles?
2. **§1.2** — which powers should be super-admin-only? That list is what makes
   your dashboard different from Himesh's.
3. **Excel vs CSV.** PRD §14.1 says Excel; we ship CSV deliberately (diffable,
   greppable, no dependency). Confirm HR is fine with it.
4. **Manager tier** — activate it, or keep everyone reporting to Himesh?
5. **Real office coordinates**, office WiFi BSSID — still outstanding. The
   Survey screen exists to collect the first one.
6. **iOS BSSID entitlement** — team is mixed iPhone/Android, so this gates
   `wifi_required` for everyone. Worth filing now; Apple review takes weeks.
