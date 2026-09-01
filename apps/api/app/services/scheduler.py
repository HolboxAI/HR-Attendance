"""The jobs that used to be a human remembering.

Three of them, from the PRD's own list: monthly leave accrual on a timer, a
"you haven't checked in" nudge past the late threshold, and a "you haven't
punched out" nudge after shift end. Each one is a query plus a notification
row - nothing here computes attendance, that stays the resolver's job.

The rules this file lives by:

- **`tick()` takes `now` as a parameter.** Same reason the resolver does: the
  tests can replay any minute of any day without waiting for it. The loop in
  app/main.py passes org_now(); nothing in here reads a clock.
- **Every job is idempotent, and the LOCK IS A ROW.** A ScheduledJobRun with a
  unique (job_name, dedupe_key) is inserted and flushed BEFORE the work, so a
  second firing - another tick, another worker, a restart mid-commit - hits
  the constraint and walks away. In-memory "have I run" flags die with the
  process; the row does not.
- **Nudges expire.** A late alert after the shift already ended, or a
  punch-out nudge about the day before yesterday, is noise about a day the
  board already flags. Silence past the window is deliberate, and the
  correction flow is the recovery path - not this.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import org_now
from app.core.config import settings
from app.models.attendance import PunchEvent
from app.models.employee import Employee, User
from app.models.enums import PunchDirection
from app.models.org import Organization
from app.models.scheduler import ScheduledJobRun
from app.services.attendance import _aware, policy_for
from app.services.leave import accrue_month, is_holiday, leave_fraction_on
from app.services.notifications import notify, notify_hr
from app.services.resolver import ShiftPolicy, shift_bounds, shift_date_for


def _claim(db: Session, *, org_id: uuid.UUID, job: str, key: str,
           detail: dict) -> ScheduledJobRun | None:
    """Insert the run row first; the unique constraint is the only lock.

    Returns None when someone else - an earlier tick, another process -
    already holds it. The insert happens inside a SAVEPOINT so a duplicate
    rolls back only itself, not the sibling nudges this tick has already
    written but not yet committed. Claim-then-work means a crash before
    commit undoes BOTH, so the job is retried next tick rather than
    half-done.
    """
    run = ScheduledJobRun(
        id=uuid.uuid4(), org_id=org_id, job_name=job, dedupe_key=key, detail=detail,
    )
    try:
        with db.begin_nested():
            db.add(run)
    except IntegrityError:
        return None
    return run


def _user_for(db: Session, employee: Employee) -> User | None:
    return db.scalar(select(User).where(
        User.employee_id == employee.id, User.is_active.is_(True),
    ))


def _accepted_punches(
    db: Session, employee: Employee, policy: ShiftPolicy, shift_date: date,
) -> list[PunchEvent]:
    """Accepted punches belonging to this shift-date, oldest first.

    Same generous window + shift_date_for filter as recompute_day, so an
    overnight punch-out at 03:30 counts against the shift it closes.
    """
    window_start = datetime.combine(
        shift_date - timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc
    )
    window_end = window_start + timedelta(days=3)
    rows = db.scalars(
        select(PunchEvent)
        .where(and_(
            PunchEvent.employee_id == employee.id,
            PunchEvent.event_ts_utc >= window_start,
            PunchEvent.event_ts_utc < window_end,
            PunchEvent.rejection_reason.is_(None),
        ))
        .order_by(PunchEvent.event_ts_utc)
    ).all()
    return [r for r in rows if shift_date_for(_aware(r.event_ts_utc), policy) == shift_date]


def _active_employees(db: Session, org_id: uuid.UUID) -> list[Employee]:
    return list(db.scalars(select(Employee).where(
        Employee.org_id == org_id, Employee.is_active.is_(True),
    )))


# ---------------------------------------------------------------------------
# Job 1: monthly accrual
# ---------------------------------------------------------------------------

def run_monthly_accrual(db: Session, org: Organization, now: datetime) -> dict | None:
    """Credit the CURRENT month, once, on the first tick that sees it.

    accrue_month is already idempotent per employee/type/month; the job row on
    top of it exists so a tick a minute does not loop every employee sixty
    times an hour, and so "when did the timer actually fire" has an answer.

    Deliberately NOT a catch-up over past months: accrue_month credits every
    active employee for whatever month it is given, so backfilling months
    would hand a November hire January's leave. A month missed because the
    server was down is HR's call, via the existing POST /admin/leave/accrue.
    """
    run = _claim(db, org_id=org.id, job="monthly_accrual",
                 key=f"{org.id}:{now:%Y-%m}", detail={})
    if run is None:
        return None

    result = accrue_month(db, org_id=org.id, year=now.year, month=now.month)
    run.detail = result

    # Tell HR it happened - the row-that-is-a-notification, push or no push.
    notify_hr(
        db, org_id=org.id, category="leave_accrual",
        title="Monthly leave accrual credited",
        body=(f"Accrual for {now:%B %Y}: {result['credited']} credits written, "
              f"{result['skipped']} already done."),
        data={"year": now.year, "month": now.month, **result},
    )
    db.flush()
    return result


# ---------------------------------------------------------------------------
# Job 2: late alert ("you haven't checked in")
# ---------------------------------------------------------------------------

def run_late_alerts(db: Session, org: Organization, now: datetime) -> list[str]:
    """Nudge whoever should be at work by now and has no accepted punch.

    Fires between (start + grace + late_alert_after_minutes) and shift end.
    After the end it stays silent on purpose - by then the day is an absence
    the board already shows, and "you were late this morning" at 9pm helps
    nobody. Goes to the employee, and to their manager if they have one -
    never the full HR fanout, which at eleven people would be a daily wall.
    """
    nudged: list[str] = []
    for emp in _active_employees(db, org.id):
        # Today and yesterday cover every live shift, including Ritesh's
        # 22:00-06:00 whose small hours belong to yesterday's shift-date.
        for shift_date in (now.date(), now.date() - timedelta(days=1)):
            policy, _tpl = policy_for(db, emp, shift_date)
            if shift_date.weekday() not in policy.working_days:
                continue
            start, end = shift_bounds(policy, shift_date)
            due = start + timedelta(
                minutes=policy.grace_minutes + settings.late_alert_after_minutes
            )
            if not (due <= now < end):
                continue
            # Any approved leave - full OR half - silences the alert. A
            # half-day leave means a punch is expected sometime, but which
            # half is on leave is not recorded, so a 09:40 alert at someone
            # excused until 14:00 would be a false alarm. Holidays likewise.
            if is_holiday(db, emp, shift_date) or leave_fraction_on(db, emp, shift_date) > 0:
                continue
            if _accepted_punches(db, emp, policy, shift_date):
                continue

            key = f"{emp.emp_code}:{shift_date.isoformat()}"
            if _claim(db, org_id=org.id, job="late_alert", key=key,
                      detail={"employee": emp.emp_code,
                              "shift_date": shift_date.isoformat()}) is None:
                continue

            local_start = start.strftime("%H:%M")
            user = _user_for(db, emp)
            if user is not None:
                notify(
                    db, org_id=org.id, user=user, category="attendance_late",
                    title="Not checked in yet",
                    body=(f"Your shift started at {local_start} and there is no "
                          f"check-in for {shift_date:%d %b}. Punch in when you "
                          "arrive, or apply for leave."),
                    data={"shift_date": shift_date.isoformat()},
                )
            if emp.manager_id is not None:
                mgr = db.get(Employee, emp.manager_id)
                mgr_user = _user_for(db, mgr) if mgr is not None else None
                if mgr_user is not None:
                    notify(
                        db, org_id=org.id, user=mgr_user, category="attendance_late",
                        title=f"{emp.full_name} has not checked in",
                        body=(f"No check-in for {shift_date:%d %b}; their shift "
                              f"started at {local_start}."),
                        data={"employee": emp.emp_code,
                              "shift_date": shift_date.isoformat()},
                    )
            
            # Notify HR as well that someone hasn't checked in yet
            notify_hr(
                db, org_id=org.id, category="attendance.absent_alert",
                title=f"Missing: {emp.full_name}",
                body=f"{emp.full_name} has not checked in for their shift on {shift_date:%d %b} (started at {local_start}).",
                data={"employee": emp.emp_code, "shift_date": shift_date.isoformat()}
            )
            
            # Fire the Slack absence alert
            from app.services.slack import post_absence_alert
            from threading import Thread
            Thread(target=post_absence_alert, args=(emp.full_name, local_start), daemon=True).start()
            
            nudged.append(key)
    return nudged


# ---------------------------------------------------------------------------
# Job 3: missing punch-out nudge
# ---------------------------------------------------------------------------

def run_punch_out_nudges(db: Session, org: Organization, now: datetime) -> list[str]:
    """Nudge whoever punched in but never out, once the shift is over.

    Fires from (end + punch_out_nudge_after_minutes) until the expiry. The
    open pair is real damage - the resolver counts those hours as zero - and
    the person holding the fix is the employee, via a punch now or a
    correction request, which is why this goes to them and not to HR.
    """
    nudged: list[str] = []
    expiry = timedelta(hours=settings.punch_out_nudge_expiry_hours)
    for emp in _active_employees(db, org.id):
        for shift_date in (now.date(), now.date() - timedelta(days=1)):
            policy, _tpl = policy_for(db, emp, shift_date)
            _start, end = shift_bounds(policy, shift_date)
            due = end + timedelta(minutes=settings.punch_out_nudge_after_minutes)
            if not (due <= now < end + expiry):
                continue

            punches = _accepted_punches(db, emp, policy, shift_date)
            if not punches:
                continue
            # Trust an explicit direction on the last punch; fall back to
            # parity for direction-less gate rows - the resolver's own rule.
            last = punches[-1]
            if last.direction == PunchDirection.OUT:
                continue
            if last.direction == PunchDirection.UNKNOWN and len(punches) % 2 == 0:
                continue

            key = f"{emp.emp_code}:{shift_date.isoformat()}"
            if _claim(db, org_id=org.id, job="punch_out_nudge", key=key,
                      detail={"employee": emp.emp_code,
                              "shift_date": shift_date.isoformat()}) is None:
                continue

            user = _user_for(db, emp)
            if user is not None:
                notify(
                    db, org_id=org.id, user=user, category="attendance_punch_out",
                    title="You haven't punched out",
                    body=(f"Your {shift_date:%d %b} shift ended at "
                          f"{end.strftime('%H:%M')} but there is no punch-out, "
                          "so those hours count as zero. Punch out now, or "
                          "submit a correction with the time you actually left."),
                    data={"shift_date": shift_date.isoformat()},
                )
            nudged.append(key)
    return nudged


# ---------------------------------------------------------------------------
# The tick
# ---------------------------------------------------------------------------

def tick(db: Session, now: datetime | None = None) -> dict:
    """Run everything due. Safe at any frequency - the rows make it so.

    Commits after each job, so one job blowing up costs that job this tick,
    not the others' work. The failure is reported in the summary rather than
    raised: the loop must outlive a bad day in one query.
    """
    if now is None:
        now = org_now()

    summary: dict = {"at": now.isoformat(), "jobs": {}, "errors": {}}
    orgs = db.scalars(select(Organization)).all()
    jobs = (
        ("monthly_accrual", run_monthly_accrual),
        ("late_alert", run_late_alerts),
        ("punch_out_nudge", run_punch_out_nudges),
    )
    for org in orgs:
        for name, fn in jobs:
            try:
                result = fn(db, org, now)
                db.commit()
                if result:
                    summary["jobs"][name] = result
            except Exception as exc:      # noqa: BLE001 - the loop must survive
                db.rollback()
                summary["errors"][name] = f"{type(exc).__name__}: {exc}"
    return summary
