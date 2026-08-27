# Role matrix — what each role actually gets

Roles STACK (`RANK` in `apps/api/app/api/deps.py`): employee(0) < manager(1) <
hr_admin(2) < super_admin(3). The API is the security boundary; the frontend's
capability model (`web/lib/capabilities.ts`) only decides what is worth
showing. Hidden UI is UX, not security.

`visible_employees()` is the one scoping rule: managers see their direct
reports plus themselves; hr_admin and above see everyone.

## Frontend-visible capability (backed by live endpoints)

| Capability | employee | manager | hr_admin | super_admin |
|---|:--:|:--:|:--:|:--:|
| Own month, dashboard "my day" | ✔ | ✔ | ✔ | ✔ |
| Own leave: balance, apply, cancel | ✔ | ✔ | ✔ | ✔ |
| Submit / withdraw own correction | ✔ | ✔ | ✔ | ✔ |
| Notifications (bell + full page) | ✔ | ✔ | ✔ | ✔ |
| Attendance board, pulse, refused log | ✘ | scoped | all | all |
| Directory + employee profiles | ✘ | scoped | all | all |
| Month CSV export | ✘ | scoped | all | all |
| Decide leave (never own) | ✘ | reports | all | all |
| Team balances | ✘ | scoped | all | all |
| Decide corrections | ✘ | ✘ | ✔ | ✔ |
| Add punch directly | ✘ | ✘ | ✔ | ✔ |
| Face enrolment | ✘ | ✘ | ✔ | ✔ |
| Leave policy / types / holidays | ✘ | ✘ | ✔ | ✔ |
| Accrual + carry-forward | ✘ | ✘ | ✔ | ✔ |
| Leave audit | ✘ | ✘ | ✔ | ✔ |
| Devices list + unbind | ✘ | ✘ | ✔ | ✔ |

Hard rules the UI enforces alongside the API:
1. **Nobody decides their own leave** - the API filters your own request out
   of your queue, so no approve button can appear on it.
2. **A 403 renders as "who this page is for"**, never as a server error.

## Notes per role

- **Employee** (web): lands on their own month; sidebar shows Dashboard,
  Notifications, Corrections, Leave only. The phone is their main surface.
- **Manager**: dormant today (nobody holds the role) but fully wired - the
  same screens render scoped data the moment `manager_id`/roles change.
- **HR admin (Himesh)**: the full operational dashboard.
- **Super admin (Krish, Dhruv, Ashley)**: identical to HR admin **on purpose** -
  verified: no endpoint anywhere requires super_admin (frontend PRD §1.2).
  The difference arrives when super-admin-only APIs exist.

## Backend-blocked future capability (no endpoint - no UI built)

| Area | Missing API |
|---|---|
| Office & presence policy admin | `GET/PUT /admin/locations` |
| Role / account administration | `PUT /admin/users/{id}/role` |
| Global audit log | anything beyond `/admin/leave/audit` |
| Security settings | entirely |
| Create employee / invite | `POST /admin/employees` |
| Shift assignment | no management route |
| Browser/admin check-in | policy decision + binding story first |

One PRD-listed blocker turned out UNBLOCKED on inspection: device **unbind**
(`DELETE /admin/devices/{employee_code}`) exists and is built into /devices.
