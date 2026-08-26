# Auth — the brief

Next milestone. Written down so the shape is decided before code exists.

## Why this is the gate

Three things are currently wide open, and each one quietly undoes work already
done:

1. `EMPLOYEE_CODE` in `apps/mobile/src/api.ts` decides who you are. Daksh can
   edit one line and punch as Ritesh.
2. The punch endpoint takes `employee_code` as a **form field**. Even after the
   app stops sending it, anyone with curl can.
3. The admin dashboard has **no auth at all**. Anyone on the office WiFi can
   open :3000 and read everyone's attendance, hours and lateness.

Point 3 is the one to fix first if time runs short. Attendance data about
identifiable people, readable by anyone on the network, is a different class of
problem from a prototype shortcut.

## Decisions

**Login is email + password.** Not phone OTP: OTP needs an SMS provider, an
account and per-message cost, and this is a prototype. Not employee-code +
password: codes are printed on things and guessable in sequence.

**Passwords hashed with `bcrypt` directly.** Already in requirements. Do NOT
add passlib — see docs/DECISIONS.md for why it is unusable now.

**JWT access token (short, ~30 min) + refresh token (long, ~30 days).** The
mobile app must survive being closed and reopened without asking for a password
every morning; nobody will use a check-in app that does.

**Tokens stored in `expo-secure-store`**, already installed. Never
AsyncStorage — that is plain text on disk.

**ONE login for everybody — employee and admin alike.** Not a separate admin
login. One credential per person; what you can do comes from the role on your
account. Two separate systems means two sets of credentials to remember to
disable the day someone leaves, and that is exactly the one you forget.

**Roles already exist** on the `User` model: `super_admin`, `hr_admin`,
`manager`, `employee`. Enforce them as a FastAPI dependency, not as scattered
`if` statements.

**Admins are employees too.** Krish is the super admin AND punches in every
morning. Ashley runs Operations AND punches in. So role must never be treated
as exclusive:

- Everyone with an `employee_id` can punch and see their own history.
- `manager` additionally sees and approves for their own reports only.
- `hr_admin` additionally sees everyone, enrols faces, corrects attendance.
- `super_admin` additionally manages users, roles, office location and policy.

Each level ADDS to the one below. An admin never loses the ability to punch.

**Where you land after login follows the role**, but nothing is hidden that the
role permits: an admin signing in on the phone gets the punch screen, and the
dashboard shows a "Check in" entry point too, rather than making them switch
devices to mark their own attendance.

**No self-service signup.** HR creates the user; there is no public register
endpoint. A company of 7 does not need one, and it is an obvious hole.

## Scope

- `POST /auth/login` → access + refresh, plus the user's role and employee_id
  so each client knows what to render
- `POST /auth/refresh`
- `POST /auth/logout` (invalidate the refresh token)
- `POST /auth/set-password` for a first-time invite
- `get_current_user` dependency; `require_role(...)` on admin routes
- Seed Krish (BX001) as `super_admin` so there is a way in, and Ashley (BX006,
  Operations) as `hr_admin`. Print the passwords once on first run; never
  commit them. Both are linked to their employee records, so both can punch.
- Login screen in the mobile app; the punch screen reads identity from the
  token
- Login for the dashboard; every admin page behind it
- **Bind the phone on first login** — write a `MobileDevice` row (the model
  already exists) and reject punches from an unbound install_id

## The part that is easy to get wrong

**Deleting `employee_code` from the punch endpoint is the actual fix.** Adding
auth while leaving that parameter accepted changes nothing — the old path still
works, and now it looks secure. Remove the parameter, remove the form field,
and add a test that a punch with no valid token is refused with 401.

The same applies to `EMPLOYEE_CODE` in the mobile app: delete the constant,
don't just stop reading it.

## Definition of done

- [ ] A punch with no token is refused. Test proves it.
- [ ] A punch cannot name a different employee. The parameter is gone, not ignored.
- [ ] An employee token cannot reach any admin endpoint.
- [ ] An admin token CAN still punch — admins are employees too.
- [ ] A manager sees their own reports and not the whole company.
- [ ] There is exactly one login form; no separate admin credential exists.
- [ ] The dashboard redirects to login when signed out.
- [ ] Closing and reopening the app does not require a password.
- [ ] An unbound phone is refused, and HR can clear a binding when someone
      genuinely changes handset.
- [ ] `demo_day.py` still passes, authenticating like a real client would.
