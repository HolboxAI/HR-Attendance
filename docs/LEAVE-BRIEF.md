# Leave — the brief

## Why this, and why now

Right now **approved leave and public holidays both read as "absent."**

`resolve_day()` already accepts `is_on_leave` and `is_holiday`. Nothing passes
them — `recompute_day()` calls it without either. So the day Ashley approves
Dhruv's Diwali leave, the board still shows him absent, and so does his month.

Wiring that is the actual milestone. The CRUD around it is the easy part; a
leave module that stores requests but leaves attendance still saying "absent"
has delivered nothing.

## HR edits the policy, not a developer

These are HR's settings, so **Ashley (`hr_admin`) must be able to change every
one of them from the dashboard** — leave year, each type's quota and accrual,
carry-forward and its cap, the sandwich rule, the backdating window, and the
holiday calendar. Nothing here may live only in code or a config file: the
first time a quota changes, nobody should need a developer.

Store them in the database (`leave_types` plus an org-level settings row), read
them at runtime, and put a **Leave policy** page behind `hr_admin`.

**Every change is audited** — who, when, old value, new value. Quotas decide
what people are owed; "it says 12 now but I'm sure it was 15" has to be
answerable.

### The trap: changing policy mid-year

If Ashley raises Earned Leave from 15 to 18 in August, what happens to balances
already accrued?

**Rule: a policy change never silently rewrites history.** It applies from the
next accrual run forward. Balances already earned stay as they are, and the
page says so plainly before saving — something like *"Applies from next month's
accrual. Existing balances are unchanged."*

If HR genuinely wants to backdate, that is a separate, deliberate action with
its own confirmation and its own audit entry. Never a silent side effect of
editing a number.

Same for the holiday calendar: **adding or removing a holiday must trigger a
recompute** of the affected dates, or the board keeps showing the old answer.

## Defaults for Krish to confirm

These ship as the starting values; HR can change them in the UI afterwards.
They are company policy, not engineering:

1. **Leave year:** January–December, or April–March? (Indian companies use
   both; April–March aligns with the financial year.)
2. **Types and quotas.** Suggested starting point, to be confirmed:
   - Casual (CL) — 12/year, accrues monthly, lapses at year end
   - Sick (SL) — 6/year, accrues monthly, lapses
   - Earned/Privilege (EL) — 15/year, accrues monthly, carries forward up to 30
   - Loss of Pay (LOP) — unlimited, no balance, deducted from salary later
3. **Sandwich rule** — if someone takes Friday and Monday, does the weekend
   count as leave too? Common in Indian firms and much resented. **Default OFF**
   unless Krish says otherwise. Make it a policy flag, never hardcoded.
4. **Backdating** — how many days back may an employee apply? Default 7, with
   HR able to go further.

## Model

    leave_types        id, org_id, code, name, annual_quota, accrual_rule,
                       carries_forward, carry_cap, is_paid, requires_proof
    leave_balances     id, employee_id, leave_type_id, period,
                       opening, accrued, used, encashed
    leave_requests     id, employee_id, leave_type_id, from_date, to_date,
                       half_day_start, half_day_end, reason, status,
                       approver_id, decided_at, decided_note
    holidays           id, org_id, date, name, is_optional

Follow the house style: append-only where history matters, `deleted_at`
everywhere, an audit row on every state change. A cancelled request is a status
change, never a delete — "who approved this and when" must survive.

## The integration — the part that matters

`recompute_day()` must look up, for that employee and date:

- an **approved** leave request covering it → `is_on_leave=True`
- a holiday for their location → `is_holiday=True`

and pass both into `resolve_day()`.

Then: **approving or cancelling leave must trigger a recompute** for every
affected date. Otherwise the board stays wrong until something else happens to
touch that day.

Three cases to get right:

- **A punch on an approved leave day.** They came in anyway. Do NOT silently
  ignore it and do NOT silently cancel the leave — flag it for HR. Both facts
  are true and a human decides.
- **Leave spanning a weekend or holiday.** Only working days consume balance,
  unless the sandwich policy is on.
- **Half days.** Half a day of leave plus half a day worked is a full day, not
  an absence.

## Scope

- `GET /leave/types`, `GET /leave/balance` (mine), `POST /leave/request`,
  `GET /leave/my-requests`, `POST /leave/{id}/cancel`
- `GET /admin/leave/pending`, `POST /admin/leave/{id}/decide`
- `GET/POST /admin/holidays`
- Balance check on submit — refuse over-balance unless the type is unpaid
- Overlapping requests refused
- Monthly accrual: an idempotent job, safe to run twice
- Mobile: apply for leave, see balance, see my requests
- Dashboard: pending queue for approvers, holiday calendar, balances per person
- Seed India's national holidays for 2026 plus Gujarat state holidays

## Definition of done

- [ ] An approved leave day shows **On leave** on the board, not Absent.
- [ ] A public holiday shows **Holiday** for everyone, not Absent.
- [ ] Approving leave immediately updates days already computed as absent.
- [ ] Cancelling leave puts those days back.
- [ ] Applying for more than the balance is refused, with the balance shown.
- [ ] Two overlapping requests cannot both exist.
- [ ] A punch on a leave day is flagged to HR, not silently swallowed.
- [ ] Leave across a weekend consumes only working days.
- [ ] Running the accrual job twice does not double anyone's balance.
- [ ] An employee cannot approve their own leave — not even an admin.
- [ ] Ashley (hr_admin) can change every leave setting from the dashboard —
      quotas, accrual, carry-forward, sandwich rule, backdating window — with
      no developer and no restart.
- [ ] A plain employee cannot reach the leave policy page or its endpoints.
- [ ] Changing a quota does not alter balances already accrued, and the page
      says so before saving.
- [ ] Every policy change writes an audit row with old and new values.
- [ ] Adding a holiday recomputes those dates and they stop showing as absent.
