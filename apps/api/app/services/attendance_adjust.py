"""An admin can change what a day SHOWS. The punches stay where they were.

Worked minutes are not part of the edit. They remain the total the punches
already computed. A later edit does not delete the earlier one: the newest
row is what the table, the PDF, and the 11:59 mail read, and the older row
is still the answer to "who changed this the first time".
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.attendance import AttendanceAdjustment, AttendanceDay
from app.models.employee import Employee, User
from app.services.leave import audit

IST = ZoneInfo("Asia/Kolkata")
ALLOWED_STATUS = ("present", "absent", "half_day", "on_leave", "wfh")


def adjustment_remark(previous_status: str, name: str, reason: str) -> str:
    """The line the PDF and the mail print for an edited day."""
    word = (previous_status or "unmarked").replace("_", " ").title()
    who = name.strip() if name and name.strip() else "Admin"
    return f"Was {word}. Changed by {who}. {reason.strip()}"


def _aware(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def latest_for(
    db: Session,
    employee_ids: list[uuid.UUID],
    start: date,
    end: date,
) -> dict[tuple[uuid.UUID, date], AttendanceAdjustment]:
    """The current edit for each employee and day in the range. Oldest first."""
    if not employee_ids:
        return {}
    rows = db.scalars(
        select(AttendanceAdjustment)
        .where(
            AttendanceAdjustment.employee_id.in_(employee_ids),
            AttendanceAdjustment.shift_date >= start,
            AttendanceAdjustment.shift_date <= end,
            AttendanceAdjustment.deleted_at.is_(None),
        )
        .order_by(AttendanceAdjustment.created_at)
    ).all()
    out: dict[tuple[uuid.UUID, date], AttendanceAdjustment] = {}
    for row in rows:
        out[(row.employee_id, row.shift_date)] = row
    return out


def shown_status_times(day: AttendanceDay | None, adjustment: AttendanceAdjustment | None):
    """Status and clock times after an admin edit. Worked minutes are not here."""
    if day is None:
        status, first_in, last_out = "not_marked", None, None
    else:
        status = day.status.value if hasattr(day.status, "value") else str(day.status)
        first_in, last_out = _aware(day.first_in), _aware(day.last_out)
    if adjustment is None:
        return status, first_in, last_out
    status = adjustment.status
    if adjustment.first_in is not None:
        first_in = _aware(adjustment.first_in)
    if adjustment.last_out is not None:
        last_out = _aware(adjustment.last_out)
    return status, first_in, last_out


def clock_on(shift_date: date, hhmm: str | None) -> datetime | None:
    """A clock time typed on the form, on that shift date, in the org zone."""
    if hhmm is None:
        return None
    text = hhmm.strip()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) < 2:
        raise ValueError("Check-in and check-out times use HH:MM")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("Check-in and check-out times use HH:MM")
    local = datetime.combine(shift_date, time(hour, minute), tzinfo=IST)
    return local.astimezone(timezone.utc)


def actor_name(db: Session, user: User) -> str:
    if user.employee_id:
        person = db.get(Employee, user.employee_id)
        if person is not None and person.full_name:
            return person.full_name
    if user.email:
        handle = user.email.split("@")[0].replace(".", " ").title()
        return handle or user.email
    return "Admin"


def sync_leave_for_adjustment(
    db: Session,
    *,
    actor: User,
    employee: Employee,
    shift_date: date,
    status: str,
    reason: str,
    leave_type_code: str | None = None,
):
    """Sync LeaveRequest and LeaveBalance when an admin manually changes a day's status.

    - on_leave: consumes 1.0 day from employee leave balance and creates/updates approved LeaveRequest.
    - half_day: consumes 0.5 day from employee leave balance and creates/updates approved LeaveRequest.
    - present / absent / wfh: if day had an approved single-day leave, cancels it and restores balance.
    """
    from app.models.leave import LeaveRequest, LeaveType, LeaveBalance, AuditLog
    from app.models.enums import LeaveStatus
    from app.services.leave import policy as get_leave_policy, period_for, balance as get_leave_balance

    existing_leaves = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.from_date <= shift_date,
            LeaveRequest.to_date >= shift_date,
            LeaveRequest.deleted_at.is_(None),
        )
    ).all()

    target_days = 1.0 if status == "on_leave" else (0.5 if status == "half_day" else 0.0)

    if target_days > 0:
        single_day_lr = next(
            (lr for lr in existing_leaves if lr.from_date == shift_date and lr.to_date == shift_date),
            None,
        )
        if single_day_lr is not None:
            current_days = float(single_day_lr.days_consumed)
            delta = target_days - current_days
            if delta != 0:
                lt = db.get(LeaveType, single_day_lr.leave_type_id)
                if lt:
                    bal = get_leave_balance(db, employee, lt, single_day_lr.period)
                    bal.used = max(0.0, float(bal.used) + delta)
                single_day_lr.days_consumed = target_days
                single_day_lr.half_day_start = (target_days == 0.5)
                single_day_lr.half_day_end = (target_days == 0.5)
                single_day_lr.reason = reason
                single_day_lr.decided_note = f"Manual adjustment to {status}: {reason}"
                db.flush()
                audit(
                    db,
                    org_id=employee.org_id,
                    actor=actor,
                    entity="leave_balance",
                    entity_id=bal.id if lt else single_day_lr.id,
                    action="update",
                    changes={"used": {"old": float(bal.used) - delta, "new": float(bal.used)}},
                    note=f"{employee.emp_code} leave balance updated ({delta:+.1f}d) due to attendance edit to {status}",
                )
            return single_day_lr
        else:
            lt = None
            if leave_type_code:
                lt = db.scalar(
                    select(LeaveType).where(
                        LeaveType.org_id == employee.org_id,
                        LeaveType.code == leave_type_code.upper(),
                    )
                )
            if lt is None:
                for pref in ("CL", "PL", "SL"):
                    lt = db.scalar(
                        select(LeaveType).where(
                            LeaveType.org_id == employee.org_id,
                            LeaveType.code == pref,
                        )
                    )
                    if lt:
                        break
            if lt is None:
                lt = db.scalar(select(LeaveType).where(LeaveType.org_id == employee.org_id))

            pol = get_leave_policy(db, employee.org_id)
            period = period_for(pol, shift_date)

            bal = None
            if lt:
                bal = get_leave_balance(db, employee, lt, period)
                bal.used = float(bal.used) + target_days
                db.flush()

            lr = LeaveRequest(
                id=uuid.uuid4(),
                org_id=employee.org_id,
                employee_id=employee.id,
                leave_type_id=lt.id if lt else uuid.uuid4(),
                from_date=shift_date,
                to_date=shift_date,
                half_day_start=(target_days == 0.5),
                half_day_end=(target_days == 0.5),
                reason=reason,
                status=LeaveStatus.APPROVED,
                days_consumed=target_days,
                period=period,
                approver_id=actor.id,
                decided_at=datetime.now(timezone.utc),
                decided_note=f"Manual attendance edit by {actor_name(db, actor)}: {reason}",
            )
            db.add(lr)
            db.flush()

            if lt and bal:
                audit(
                    db,
                    org_id=employee.org_id,
                    actor=actor,
                    entity="leave_balance",
                    entity_id=bal.id,
                    action="update",
                    changes={"used": {"old": float(bal.used) - target_days, "new": float(bal.used)}},
                    note=f"{employee.emp_code} {lt.code} deducted {target_days}d due to attendance edit to {status}",
                )
            return lr
    else:
        # Revert single-day leave requests if changing to present, absent, wfh
        for lr in existing_leaves:
            if lr.from_date == shift_date and lr.to_date == shift_date:
                days_to_restore = float(lr.days_consumed)
                lt = db.get(LeaveType, lr.leave_type_id)
                if lt and days_to_restore > 0:
                    bal = get_leave_balance(db, employee, lt, lr.period)
                    bal.used = max(0.0, float(bal.used) - days_to_restore)
                    db.flush()
                    audit(
                        db,
                        org_id=employee.org_id,
                        actor=actor,
                        entity="leave_balance",
                        entity_id=bal.id,
                        action="update",
                        changes={"used": {"old": float(bal.used) + days_to_restore, "new": float(bal.used)}},
                        note=f"{employee.emp_code} {lt.code} restored +{days_to_restore}d due to attendance edit to {status}",
                    )
                lr.status = LeaveStatus.CANCELLED
                lr.cancelled_at = datetime.now(timezone.utc)
                db.flush()
        return None


def record_adjustment(
    db: Session,
    *,
    actor: User,
    employee: Employee,
    shift_date: date,
    status: str,
    first_in: datetime | None,
    last_out: datetime | None,
    reason: str,
    day: AttendanceDay | None,
    leave_type_code: str | None = None,
) -> AttendanceAdjustment:
    note = (reason or "").strip()
    if not note:
        raise ValueError("A reason is required")
    if len(note) > 400:
        raise ValueError("The reason is too long")
    if status not in ALLOWED_STATUS:
        raise ValueError(f"Status must be one of: {', '.join(ALLOWED_STATUS)}")

    from app.models.enums import AttendanceStatus
    sync_leave_for_adjustment(
        db,
        actor=actor,
        employee=employee,
        shift_date=shift_date,
        status=status,
        reason=note,
        leave_type_code=leave_type_code,
    )

    current = latest_for(db, [employee.id], shift_date, shift_date).get((employee.id, shift_date))
    if current is not None:
        previous = current.status
    elif day is not None:
        previous = day.status.value if hasattr(day.status, "value") else str(day.status)
    else:
        previous = "not_marked"

    row = AttendanceAdjustment(
        id=uuid.uuid4(),
        org_id=employee.org_id,
        employee_id=employee.id,
        shift_date=shift_date,
        status=status,
        first_in=first_in,
        last_out=last_out,
        previous_status=previous,
        reason=note,
        changed_by_user_id=actor.id,
        changed_by_name=actor_name(db, actor),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(row)

    if day is not None:
        try:
            day.status = AttendanceStatus(status)
        except ValueError:
            pass
        if first_in is not None:
            day.first_in = first_in
        if last_out is not None:
            day.last_out = last_out
        day.is_regularized = True
        day.has_exception = False
        day.exception_note = adjustment_remark(previous, actor_name(db, actor), note)
        day.computed_at = datetime.now(timezone.utc)

    db.flush()
    audit(
        db,
        org_id=employee.org_id,
        actor=actor,
        entity="attendance_adjustment",
        entity_id=row.id,
        action="adjust",
        changes={
            "status": {"old": previous, "new": status},
            "shift_date": {"old": None, "new": shift_date.isoformat()},
        },
        note=note,
    )
    return row


def display_columns(
    db: Session,
    employee: Employee,
    day: AttendanceDay | None,
    adjustment: AttendanceAdjustment | None,
    shift_timing: str,
) -> dict:
    """The mail columns for one day, after an admin edit if there is one.

    Worked minutes and extra hours come from the computed day, never from
    the edit. The edit only changes status, the two clock times, and the note.
    """
    from app.services.scheduler import _extra_fields, mail_row_details

    status, first_in, last_out = shown_status_times(day, adjustment)
    worked = day.worked_minutes if day is not None else 0
    if status in ("weekly_off", "holiday") and worked <= 0:
        first_in = None
        last_out = None
        late = 0
    else:
        late = day.late_minutes if day is not None else 0
    details = mail_row_details(
        db,
        employee,
        day,
        shift_date=day.shift_date if day is not None else adjustment.shift_date,
        tz=IST,
        shift_timing=shift_timing,
        status=status,
        late_minutes=late,
        checked_in=first_in is not None,
        adjustment=adjustment,
    )
    extra = _extra_fields(day)
    worked = day.worked_minutes if day is not None else 0
    return {
        "status": status,
        "first_in": first_in,
        "last_out": last_out,
        "worked_minutes": worked,
        "break_minutes": day.break_minutes if day is not None else 0,
        "late_minutes": late,
        "overtime_minutes": extra["extra_minutes"],
        "extra_str": extra["extra_str"],
        "is_regularized": adjustment is not None or bool(day is not None and day.is_regularized),
        "has_exception": bool(day is not None and day.has_exception),
        "exception_note": day.exception_note if day is not None else None,
        "punch_count": day.punch_count if day is not None else 0,
        "shift_allotted": details["shift_allotted"],
        "break_windows": details["break_windows"],
        "punctuality": details["punctuality"],
        "regularised_by": details["regularised_by"],
        "leave_status": details["leave_status"],
        "leave_approved_by": details["leave_approved_by"],
        "remarks": details["remarks"],
        "department": details["department"],
        "changed_by": adjustment.changed_by_name if adjustment is not None else None,
        "previous_status": adjustment.previous_status if adjustment is not None else None,
        "adjustment_reason": adjustment.reason if adjustment is not None else None,
    }
