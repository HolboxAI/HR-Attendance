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
from datetime import date, datetime, time, timedelta, timezone
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
from app.services.attendance import _aware, policy_for, resolve_shift
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

    Fires as soon as shift start + grace period passes until shift end.
    Only evaluates employees assigned to an active Shift Group.
    """
    nudged: list[str] = []
    for emp in _active_employees(db, org.id):
        # Today and yesterday cover every live shift, including overnight shifts
        for shift_date in (now.date(), now.date() - timedelta(days=1)):
            tpl, source, group_name, assignment_id = resolve_shift(db, emp, shift_date)
            # Only evaluate employees explicitly assigned to an active Shift Group
            if source != "group" or tpl is None:
                continue

            policy, _tpl = policy_for(db, emp, shift_date)
            if shift_date.weekday() not in policy.working_days:
                continue
            start, end = shift_bounds(policy, shift_date)
            # Due immediately after grace period expires (e.g. 1:25 PM for a 1:00 PM shift)
            due = start + timedelta(minutes=policy.grace_minutes)
            if not (due <= now < end):
                continue
            # Any approved leave silences the alert
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
                    title="Marked Absent - Grace Period Expired",
                    body=(f"Your shift started at {local_start} and the {policy.grace_minutes}-minute "
                          f"grace period has expired without a check-in for {shift_date:%d %b}. "
                          "You have been marked as Absent. Submit a regularisation request if needed."),
                    data={"shift_date": shift_date.isoformat()},
                )
            if emp.manager_id is not None:
                mgr = db.get(Employee, emp.manager_id)
                mgr_user = _user_for(db, mgr) if mgr is not None else None
                if mgr_user is not None:
                    notify(
                        db, org_id=org.id, user=mgr_user, category="attendance_late",
                        title=f"{emp.full_name} marked Absent (grace expired)",
                        body=(f"No check-in for {shift_date:%d %b}; shift started at {local_start} "
                              f"and {policy.grace_minutes}m grace expired."),
                        data={"employee": emp.emp_code,
                              "shift_date": shift_date.isoformat()},
                    )
            
            # Notify HR as well that someone hasn't checked in past grace
            notify_hr(
                db, org_id=org.id, category="attendance.absent_alert",
                title=f"Marked Absent: {emp.full_name}",
                body=f"{emp.full_name} passed the {policy.grace_minutes}m grace period on {shift_date:%d %b} (started {local_start}) and is marked Absent.",
                data={"employee": emp.emp_code, "shift_date": shift_date.isoformat()}
            )

            # Post alert in Slack tagging employee
            from app.services.slack import post_not_checked_in_alert
            from threading import Thread
            local_start_str = start.strftime("%I:%M %p").lstrip("0")
            Thread(
                target=post_not_checked_in_alert,
                args=(
                    emp.full_name,
                    emp.email,
                    local_start_str,
                    shift_date.isoformat(),
                    policy.grace_minutes,
                    group_name,
                ),
                daemon=True,
            ).start()

            nudged.append(key)
    return nudged



# ---------------------------------------------------------------------------
# Job 3: break exceeded alert (> 40 mins)
# ---------------------------------------------------------------------------

def run_break_exceeded_alerts(db: Session, org: Organization, now: datetime) -> list[str]:
    """Alerts Slack if an employee has stepped out on break for >= 45 minutes during active shift."""
    nudged: list[str] = []
    tz = ZoneInfo(org.timezone or "Asia/Kolkata")
    local_now = now.astimezone(tz)
    today = local_now.date()

    for emp in _active_employees(db, org.id):
        tpl, source, group_name, assignment_id = resolve_shift(db, emp, today)
        if source != "group" or tpl is None:
            continue

        policy, _tpl = policy_for(db, emp, today)
        if today.weekday() not in policy.working_days:
            continue
        start, end = shift_bounds(policy, today)
        if not (start <= local_now < end):
            continue

        punches = _accepted_punches(db, emp, policy, today)
        if not punches:
            continue

        last = punches[-1]
        if last.direction == PunchDirection.OUT:
            time_since_out = (now - last.event_ts_utc).total_seconds() / 60
            if time_since_out >= 45:
                key = f"break_exceeded:{emp.emp_code}:{today.isoformat()}:{int(last.event_ts_utc.timestamp())}"
                if _claim(db, org_id=org.id, job="break_exceeded", key=key,
                          detail={"employee": emp.emp_code, "minutes": int(time_since_out)}) is None:
                    continue

                from app.services.slack import post_break_exceeded_alert
                from threading import Thread
                Thread(
                    target=post_break_exceeded_alert,
                    args=(emp.full_name, emp.email, int(time_since_out)),
                    daemon=True,
                ).start()
                nudged.append(key)

    return nudged


# ---------------------------------------------------------------------------
# Job 4: missing punch-out nudge
# ---------------------------------------------------------------------------

def run_punch_out_nudges(db: Session, org: Organization, now: datetime) -> list[str]:
    """Nudge whoever punched in but never out, once the shift is over.

    Fires from (end + punch_out_nudge_after_minutes) until the expiry.
    Only evaluates employees assigned to an active Shift Group.
    """
    nudged: list[str] = []
    expiry = timedelta(hours=settings.punch_out_nudge_expiry_hours)
    for emp in _active_employees(db, org.id):
        for shift_date in (now.date(), now.date() - timedelta(days=1)):
            tpl, source, group_name, assignment_id = resolve_shift(db, emp, shift_date)
            if source != "group" or tpl is None:
                continue

            policy, _tpl = policy_for(db, emp, shift_date)
            _start, end = shift_bounds(policy, shift_date)
            due = end + timedelta(minutes=settings.punch_out_nudge_after_minutes)
            if not (due <= now < end + expiry):
                continue

            punches = _accepted_punches(db, emp, policy, shift_date)
            if not punches:
                continue
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

            # Also tag the employee in Slack
            from app.services.slack import post_missed_checkout_alert
            from threading import Thread
            local_end_str = end.strftime("%I:%M %p").lstrip("0")
            Thread(
                target=post_missed_checkout_alert,
                args=(emp.full_name, emp.email, shift_date.isoformat(), local_end_str),
                daemon=True,
            ).start()

            nudged.append(key)
    return nudged


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Job 5: shift end attendance summary email & slack image (at shift end + 15m)
# ---------------------------------------------------------------------------

def run_shift_end_summaries(
    db: Session,
    org: Organization,
    now: datetime,
    force_template_id: uuid.UUID | None = None,
    for_date: date | None = None,
) -> list[str]:
    """Sends attendance summary email and Slack image 15 minutes after a shift ends (e.g. 8:15 PM).

    Summary covers all employees assigned to that shift on today's date.
    Recomputes day live to ensure accuracy.
    """
    from app.models.attendance import ShiftTemplate
    from app.services.attendance import recompute_day
    from app.services.notifications import send_shift_summary_email

    tz = ZoneInfo(org.timezone or "Asia/Kolkata")
    local_now = now.astimezone(tz)
    target_date = for_date or local_now.date()

    query = select(ShiftTemplate).where(ShiftTemplate.org_id == org.id)
    if force_template_id:
        query = query.where(ShiftTemplate.id == force_template_id)
    templates = db.scalars(query).all()

    summarized: list[str] = []
    for tmpl in templates:
        start_dt = datetime.combine(target_date, tmpl.start_time, tzinfo=tz)
        end_dt = datetime.combine(target_date, tmpl.end_time, tzinfo=tz)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        # Trigger 15 minutes after shift ends (e.g. 20:15 for a 20:00 shift)
        trigger_dt = end_dt + timedelta(minutes=15)
        cutoff_dt = end_dt + timedelta(hours=3)

        # If not forcing on-demand, verify the window and claim the dedupe row
        if not force_template_id:
            if not (trigger_dt <= local_now <= cutoff_dt):
                continue
            key = f"shift_end_summary:{tmpl.id}:{target_date.isoformat()}"
            run = _claim(
                db,
                org_id=org.id,
                job="shift_end_summary",
                key=key,
                detail={"template_name": tmpl.name, "date": target_date.isoformat()},
            )
            if run is None:
                continue
        else:
            key = f"shift_end_summary_forced:{tmpl.id}:{target_date.isoformat()}:{int(now.timestamp())}"

        # Resolve all active employees in this org assigned to this shift on target_date
        active_emps = db.scalars(
            select(Employee).where(
                Employee.org_id == org.id,
                Employee.is_active.is_(True),
                Employee.deleted_at.is_(None),
            ).order_by(Employee.emp_code)
        ).all()

        roster: list[dict] = []
        for emp in active_emps:
            tpl, source, group_name, assignment_id = resolve_shift(db, emp, target_date)
            # Only include employees explicitly assigned to this shift (via Shift Group or Direct assignment).
            if source not in ("group", "direct") or tpl is None or tpl.id != tmpl.id:
                continue

            # Always recompute live to have accurate status at shift conclusion
            day = recompute_day(db, emp, target_date)

            status_str = "absent"
            first_in_str = "—"
            last_out_str = "—"
            late_mins = 0
            hours_str = "0m"

            if day:
                status_str = day.status.value if hasattr(day.status, "value") else str(day.status)
                if day.first_in:
                    first_in_str = day.first_in.astimezone(tz).strftime("%I:%M %p").lstrip("0")
                if day.last_out:
                    last_out_str = day.last_out.astimezone(tz).strftime("%I:%M %p").lstrip("0")
                late_mins = day.late_minutes or 0
                if day.first_in and not day.last_out and status_str not in ("absent", "on_leave"):
                    status_str = "not_marked"
                worked_m = day.worked_minutes or 0
                if worked_m > 0:
                    wh = worked_m // 60
                    wm = worked_m % 60
                    hours_str = f"{wh}h {wm}m" if wh > 0 and wm > 0 else (f"{wh}h" if wh > 0 else f"{wm}m")

            if late_mins > 0:
                h = late_mins // 60
                m = late_mins % 60
                dur = f"{h}h {m}m" if h > 0 and m > 0 else (f"{h}h" if h > 0 else f"{m}m")
                late_str = f"{dur} late (Grace exceeded)"
            else:
                late_str = "On Time"

            break_m = day.break_minutes or 0 if day else 0
            if break_m >= 60:
                break_str = f"{break_m // 60}h {break_m % 60}m"
            elif break_m > 0:
                break_str = f"{break_m}m"
            else:
                break_str = "0m"

            roster.append({
                "id": str(emp.id),
                "code": emp.emp_code,
                "name": emp.full_name,
                "status": status_str,
                "first_in": first_in_str,
                "last_out": last_out_str,
                "late_minutes": late_mins,
                "late_str": late_str,
                "hours_str": hours_str,
                "break_str": break_str,
                "break_minutes": break_m,
            })

        if not roster and not force_template_id:
            continue

        stats = {
            "total": len(roster),
            "present": sum(1 for r in roster if r["status"] in ("present", "early", "wfh")),
            "late": sum(1 for r in roster if r["status"] == "late"),
            "absent": sum(1 for r in roster if r["status"] == "absent"),
            "leave": sum(1 for r in roster if r["status"] in ("on_leave", "leave", "half_day")),
        }

        timing_str = f"{tmpl.start_time.strftime('%I:%M %p').lstrip('0')} – {tmpl.end_time.strftime('%I:%M %p').lstrip('0')}"
        send_shift_summary_email(
            shift_name=tmpl.name,
            shift_timing=timing_str,
            shift_date=target_date,
            stats=stats,
            roster=roster,
        )

        # Post shift summary to Slack attendance channel
        from app.services.slack import upload_shift_summary_image_to_slack
        from threading import Thread
        Thread(
            target=upload_shift_summary_image_to_slack,
            args=(tmpl.name, timing_str, target_date, stats, roster),
            daemon=True,
        ).start()

        summarized.append(key)

    return summarized


# ---------------------------------------------------------------------------
# Job 6: End of Day final summary email (at shift end + 3h / 11:00 PM)
# ---------------------------------------------------------------------------

def run_eod_final_summaries(
    db: Session,
    org: Organization,
    now: datetime,
    force_template_id: uuid.UUID | None = None,
    for_date: date | None = None,
) -> list[str]:
    """Sends final consolidated attendance summary email & Slack Block Card at 11:00 PM.

    Re-evaluates attendance for late checkouts across all active shift groups.
    """
    from app.models.attendance import ShiftTemplate
    from app.services.attendance import recompute_day
    from app.services.notifications import send_shift_summary_email

    tz = ZoneInfo(org.timezone or "Asia/Kolkata")
    local_now = now.astimezone(tz)
    target_date = for_date or local_now.date()

    query = select(ShiftTemplate).where(ShiftTemplate.org_id == org.id)
    if force_template_id:
        query = query.where(ShiftTemplate.id == force_template_id)
    templates = db.scalars(query).all()

    summarized: list[str] = []
    for tmpl in templates:
        start_dt = datetime.combine(target_date, tmpl.start_time, tzinfo=tz)
        end_dt = datetime.combine(target_date, tmpl.end_time, tzinfo=tz)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        # Trigger at 11:00 PM local time (23:00) for shifts concluding on or before 11:00 PM
        trigger_dt = datetime.combine(target_date, time(23, 0), tzinfo=tz)
        cutoff_dt = datetime.combine(target_date, time(23, 59), tzinfo=tz)

        if not force_template_id:
            if not (trigger_dt <= local_now <= cutoff_dt):
                continue
            key = f"eod_summary:{tmpl.id}:{target_date.isoformat()}"
            run = _claim(
                db,
                org_id=org.id,
                job="eod_summary",
                key=key,
                detail={"template_name": tmpl.name, "date": target_date.isoformat()},
            )
            if run is None:
                continue
        else:
            key = f"eod_summary_forced:{tmpl.id}:{target_date.isoformat()}:{int(now.timestamp())}"

        active_emps = db.scalars(
            select(Employee).where(
                Employee.org_id == org.id,
                Employee.is_active.is_(True),
                Employee.deleted_at.is_(None),
            ).order_by(Employee.emp_code)
        ).all()

        roster: list[dict] = []
        for emp in active_emps:
            tpl, source, group_name, assignment_id = resolve_shift(db, emp, target_date)
            # Only include employees assigned to this shift via Shift Group
            if source != "group" or tpl is None or tpl.id != tmpl.id:
                continue

            day = recompute_day(db, emp, target_date)

            status_str = "absent"
            first_in_str = "—"
            last_out_str = "—"
            late_mins = 0
            hours_str = "0m"

            if day:
                status_str = day.status.value if hasattr(day.status, "value") else str(day.status)
                if day.first_in:
                    first_in_str = day.first_in.astimezone(tz).strftime("%I:%M %p").lstrip("0")
                if day.last_out:
                    last_out_str = day.last_out.astimezone(tz).strftime("%I:%M %p").lstrip("0")
                late_mins = day.late_minutes or 0
                if day.first_in and not day.last_out and status_str not in ("absent", "on_leave"):
                    status_str = "not_marked"
                worked_m = day.worked_minutes or 0
                if worked_m > 0:
                    wh = worked_m // 60
                    wm = worked_m % 60
                    hours_str = f"{wh}h {wm}m" if wh > 0 and wm > 0 else (f"{wh}h" if wh > 0 else f"{wm}m")

            if late_mins > 0:
                h = late_mins // 60
                m = late_mins % 60
                dur = f"{h}h {m}m" if h > 0 and m > 0 else (f"{h}h" if h > 0 else f"{m}m")
                late_str = f"{dur} late (Grace exceeded)"
            else:
                late_str = "On Time"

            break_m = day.break_minutes or 0 if day else 0
            if break_m >= 60:
                break_str = f"{break_m // 60}h {break_m % 60}m"
            elif break_m > 0:
                break_str = f"{break_m}m"
            else:
                break_str = "0m"

            roster.append({
                "id": str(emp.id),
                "code": emp.emp_code,
                "name": emp.full_name,
                "status": status_str,
                "first_in": first_in_str,
                "last_out": last_out_str,
                "late_minutes": late_mins,
                "late_str": late_str,
                "hours_str": hours_str,
                "break_str": break_str,
                "break_minutes": break_m,
            })

        if not roster and not force_template_id:
            continue

        stats = {
            "total": len(roster),
            "present": sum(1 for r in roster if r["status"] in ("present", "early", "wfh")),
            "late": sum(1 for r in roster if r["status"] == "late"),
            "absent": sum(1 for r in roster if r["status"] == "absent"),
            "leave": sum(1 for r in roster if r["status"] in ("on_leave", "leave", "half_day")),
        }

        timing_str = f"{tmpl.start_time.strftime('%I:%M %p').lstrip('0')} – {tmpl.end_time.strftime('%I:%M %p').lstrip('0')}"
        send_shift_summary_email(
            shift_name=f"{tmpl.name} (Final EOD)",
            shift_timing=timing_str,
            shift_date=target_date,
            stats=stats,
            roster=roster,
        )

        # Post text/block card to Slack attendance channel (without png file upload)
        from app.services.slack import post_shift_summary_to_slack
        from threading import Thread
        Thread(
            target=post_shift_summary_to_slack,
            args=(f"{tmpl.name} (Final EOD)", timing_str, target_date, stats, roster),
            daemon=True,
        ).start()

        summarized.append(key)

    return summarized



# ---------------------------------------------------------------------------
# Job 7: EOD unresolved checkout Slack alert (at 11:15 PM)
# ---------------------------------------------------------------------------

def run_unresolved_checkout_alerts(db: Session, org: Organization, now: datetime) -> list[str]:
    """Tag employees in Slack at 11:15 PM who never checked out, asking them to apply for correction."""
    from app.models.attendance import ShiftTemplate
    from app.services.attendance import recompute_day
    from app.services.slack import post_eod_unresolved_checkout_alert
    from threading import Thread

    tz = ZoneInfo(org.timezone or "Asia/Kolkata")
    local_now = now.astimezone(tz)
    target_date = local_now.date()

    templates = db.scalars(select(ShiftTemplate).where(ShiftTemplate.org_id == org.id)).all()
    alerted: list[str] = []

    for tmpl in templates:
        start_dt = datetime.combine(target_date, tmpl.start_time, tzinfo=tz)
        end_dt = datetime.combine(target_date, tmpl.end_time, tzinfo=tz)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)

        # Trigger at 11:15 PM local time (23:15)
        trigger_dt = datetime.combine(target_date, time(23, 15), tzinfo=tz)
        cutoff_dt = datetime.combine(target_date, time(23, 59), tzinfo=tz)

        if not (trigger_dt <= local_now <= cutoff_dt):
            continue

        active_emps = db.scalars(
            select(Employee).where(
                Employee.org_id == org.id,
                Employee.is_active.is_(True),
                Employee.deleted_at.is_(None),
            ).order_by(Employee.emp_code)
        ).all()

        for emp in active_emps:
            tpl, source, group_name, assignment_id = resolve_shift(db, emp, target_date)
            # Only evaluate employees assigned to an active Shift Group
            if source != "group" or tpl is None or tpl.id != tmpl.id:
                continue

            day = recompute_day(db, emp, target_date)
            # If they punched in but never punched out
            if day.first_in is not None and day.last_out is None:
                key = f"unresolved_checkout_alert:{emp.emp_code}:{target_date.isoformat()}"
                if _claim(db, org_id=org.id, job="unresolved_checkout_alert", key=key,
                          detail={"employee": emp.emp_code, "shift_date": target_date.isoformat()}) is None:
                    continue

                Thread(
                    target=post_eod_unresolved_checkout_alert,
                    args=(emp.full_name, emp.email, target_date.isoformat()),
                    daemon=True,
                ).start()

                alerted.append(key)

    return alerted



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
        ("break_exceeded", run_break_exceeded_alerts),
        ("punch_out_nudge", run_punch_out_nudges),
        ("shift_end_summary", run_shift_end_summaries),
        ("eod_summary", run_eod_final_summaries),
        ("unresolved_checkout_alert", run_unresolved_checkout_alerts),
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

