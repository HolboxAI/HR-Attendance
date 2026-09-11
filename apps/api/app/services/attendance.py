"""Where a punch becomes a day.

Two operations, and the split matters:

  record_punch  - append one immutable row, idempotently
  recompute_day - throw away the derived day and rebuild it from the raw rows

Nothing ever edits a punch. Nothing ever hand-edits an attendance day. If a
number looks wrong, you fix the input and recompute - which means the number
always matches the evidence behind it.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.attendance import (
    AttendanceDay,
    Device,
    DeviceEnrollment,
    PunchEvent,
    ShiftAssignment,
    ShiftGroup,
    ShiftGroupMember,
    ShiftTemplate,
)
from app.models.employee import Employee
from app.models.org import Organization
from app.models.enums import AttendanceStatus, PunchDirection, PunchSource
from app.services.resolver import Punch, ShiftPolicy, resolve_day, shift_date_for

DEFAULT_POLICY = ShiftPolicy(start_time=time(9, 0), end_time=time(18, 0))


def dedupe_hash(
    device_serial: str | None,
    device_user_id: str | None,
    employee_code: str | None,
    ts: datetime,
    direction: str = "",
) -> str:
    """Same identity, same second, SAME DIRECTION, same row.

    A phone retrying a queued punch, or a reader replaying its buffer, must not
    create duplicates - and a retry always carries the same direction, so
    including it changes nothing for that case. What it fixes: an IN and an
    OUT landing in the same second used to collapse into one row, the second
    punch silently vanishing while the API answered "accepted". The UNIQUE
    index enforces the rule; this just produces the key.
    """
    stamp = ts.astimezone(timezone.utc).isoformat(timespec="seconds")
    key = (f"{device_serial or ''}|{device_user_id or ''}|"
           f"{employee_code or ''}|{stamp}|{direction}")
    return hashlib.sha256(key.encode()).hexdigest()


def resolve_shift(
    db: Session, employee: Employee, on: date
) -> tuple[ShiftTemplate | None, str, str | None, uuid.UUID | None]:
    """Resolves the shift template for an employee on a given date following PRD §8.5:
    1. Employee-specific shift assignment (direct override)
    2. Shift group assignment (via ShiftGroupMember -> ShiftGroup)
    3. Organization-wide default shift (Organization.settings['default_shift_template_id'] or first template)

    Returns: (template, source, group_name, assignment_id)
    where source is "direct" | "group" | "default" | "fallback"
    """
    # 1. Direct employee assignment
    stmt = (
        select(ShiftTemplate, ShiftAssignment.id)
        .join(ShiftAssignment, ShiftAssignment.shift_template_id == ShiftTemplate.id)
        .where(
            and_(
                ShiftAssignment.employee_id == employee.id,
                ShiftAssignment.effective_from <= on,
                (ShiftAssignment.effective_to.is_(None) | (ShiftAssignment.effective_to >= on)),
            )
        )
        .order_by(ShiftAssignment.effective_from.desc())
    )
    row = db.execute(stmt).first()
    if row:
        return row[0], "direct", None, row[1]

    # 2. Shift group assignment
    stmt_group = (
        select(ShiftTemplate, ShiftGroup.name)
        .join(ShiftGroup, ShiftGroup.shift_template_id == ShiftTemplate.id)
        .join(ShiftGroupMember, ShiftGroupMember.shift_group_id == ShiftGroup.id)
        .where(
            and_(
                ShiftGroupMember.employee_id == employee.id,
                ShiftGroup.org_id == employee.org_id,
                ShiftGroup.deleted_at.is_(None),
            )
        )
        .order_by(ShiftGroupMember.created_at.desc())
    )
    group_row = db.execute(stmt_group).first()
    if group_row:
        return group_row[0], "group", group_row[1], None

    # 3. Organization default shift
    org = db.get(Organization, employee.org_id)
    default_id = org.settings.get("default_shift_template_id") if org and org.settings else None
    if default_id:
        try:
            tpl = db.get(ShiftTemplate, uuid.UUID(str(default_id)))
            if tpl and tpl.org_id == employee.org_id:
                return tpl, "default", None, None
        except (ValueError, TypeError):
            pass

# No explicit default template set; falls back to DEFAULT_POLICY

    return None, "fallback", None, None


def policy_for(db: Session, employee: Employee, on: date) -> tuple[ShiftPolicy, uuid.UUID | None]:
    """The shift in force for this employee on this date."""
    tpl, _, _, _ = resolve_shift(db, employee, on)
    if tpl is None:
        return DEFAULT_POLICY, None

    return (
        ShiftPolicy(
            start_time=tpl.start_time,
            end_time=tpl.end_time,
            break_minutes=tpl.break_minutes,
            grace_minutes=tpl.grace_minutes,
            half_day_after_minutes=tpl.half_day_after_minutes,
            full_day_after_minutes=tpl.full_day_after_minutes,
            cutover_hour=tpl.cutover_hour,
            working_days=tuple(tpl.working_days or (0, 1, 2, 3, 4, 5)),
        ),
        tpl.id,
    )


def resolve_employee(
    db: Session, *, employee_code: str | None, device_serial: str | None,
    device_user_id: str | None,
) -> Employee | None:
    if employee_code:
        return db.scalar(select(Employee).where(Employee.emp_code == employee_code))

    if device_serial and device_user_id:
        stmt = (
            select(Employee)
            .join(DeviceEnrollment, DeviceEnrollment.employee_id == Employee.id)
            .join(Device, Device.id == DeviceEnrollment.device_id)
            .where(
                and_(
                    Device.serial_no == device_serial,
                    DeviceEnrollment.device_user_id == device_user_id,
                )
            )
        )
        return db.scalar(stmt)

    return None


def record_punch(
    db: Session,
    *,
    org_id: uuid.UUID,
    employee: Employee | None,
    event_ts: datetime,
    source: PunchSource,
    direction: PunchDirection = PunchDirection.UNKNOWN,
    device_id: uuid.UUID | None = None,
    device_serial: str | None = None,
    device_user_id: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    photo_key: str | None = None,
    geofence_ok: bool | None = None,
    distance_m: float | None = None,
    face_ok: bool | None = None,
    face_similarity: float | None = None,
    rejection_reason: str | None = None,
    raw: dict | None = None,
) -> tuple[PunchEvent, bool]:
    """Returns (event, created). created=False means we've seen this one before."""
    digest = dedupe_hash(
        device_serial, device_user_id,
        employee.emp_code if employee else None,
        event_ts,
        direction.value if direction else "",
    )

    existing = db.scalar(select(PunchEvent).where(PunchEvent.dedupe_hash == digest))
    if existing is not None:
        return existing, False

    event = PunchEvent(
        id=uuid.uuid4(),
        org_id=org_id,
        employee_id=employee.id if employee else None,
        device_id=device_id,
        source=source,
        direction=direction,
        event_ts_utc=event_ts.astimezone(timezone.utc),
        received_ts_utc=datetime.now(timezone.utc),
        lat=lat,
        lng=lng,
        photo_key=photo_key,
        geofence_ok=geofence_ok,
        distance_m=distance_m,
        face_ok=face_ok,
        face_similarity=face_similarity,
        rejection_reason=rejection_reason,
        raw_payload=raw or {},
        dedupe_hash=digest,
        is_unmatched=employee is None,
    )
    db.add(event)
    db.flush()
    return event, True


def recompute_day(db: Session, employee: Employee, shift_date: date) -> AttendanceDay:
    """Delete nothing, trust nothing, rebuild from the raw punches."""
    policy, template_id = policy_for(db, employee, shift_date)

    # Pull a generous window and let shift_date_for decide what belongs, so an
    # overnight shift picks up the punches that land after midnight.
    window_start = datetime.combine(
        shift_date - timedelta(days=1), time(0, 0), tzinfo=timezone.utc
    )
    window_end = datetime.combine(
        shift_date + timedelta(days=2), time(0, 0), tzinfo=timezone.utc
    )

    rows = db.scalars(
        select(PunchEvent)
        .where(
            and_(
                PunchEvent.employee_id == employee.id,
                PunchEvent.event_ts_utc >= window_start,
                PunchEvent.event_ts_utc < window_end,
                # Rejected punches are kept for the audit trail but must never
                # count towards hours worked.
                PunchEvent.rejection_reason.is_(None),
            )
        )
        .order_by(PunchEvent.event_ts_utc)
    ).all()

    punches = [
        Punch(ts_utc=_aware(r.event_ts_utc), direction=r.direction.value, source=r.source.value)
        for r in rows
        if shift_date_for(_aware(r.event_ts_utc), policy) == shift_date
    ]

    # The integration this milestone exists for. resolve_day has always
    # accepted these two; until now nothing passed them, so approved leave and
    # public holidays both came out as "absent".
    from app.services.leave import is_holiday, leave_fraction_on

    resolved = resolve_day(
        punches, policy, shift_date,
        is_holiday=is_holiday(db, employee, shift_date),
        leave_fraction=leave_fraction_on(db, employee, shift_date),
        as_of=datetime.now(timezone.utc),
    )
    
    is_regularized = any(p.source == "manual" for p in punches)

    day = db.scalar(
        select(AttendanceDay).where(
            and_(AttendanceDay.employee_id == employee.id, AttendanceDay.shift_date == shift_date)
        )
    )
    if day is None:
        day = AttendanceDay(id=uuid.uuid4(), org_id=employee.org_id,
                            employee_id=employee.id, shift_date=shift_date)
        db.add(day)

    day.shift_template_id = template_id
    day.first_in = resolved.first_in
    day.last_out = resolved.last_out
    day.worked_minutes = resolved.worked_minutes
    day.break_minutes = resolved.break_minutes
    day.late_minutes = resolved.late_minutes
    day.early_out_minutes = resolved.early_out_minutes
    day.overtime_minutes = resolved.overtime_minutes
    is_wfh = employee.is_wfh_enabled
    if not is_wfh:
        from app.models.wfh_request import WFHRequest
        from app.models.enums import CorrectionStatus
        wfh_req = db.scalar(
            select(WFHRequest).where(
                and_(
                    WFHRequest.employee_id == employee.id,
                    WFHRequest.shift_date == shift_date,
                    WFHRequest.status == CorrectionStatus.APPROVED,
                )
            )
        )
        if wfh_req:
            is_wfh = True

    status_val = AttendanceStatus(resolved.status)
    if is_wfh and status_val == AttendanceStatus.PRESENT:
        # If they are WFH and present, their status is WFH.
        # Note: if they are half_day, we could leave it as half_day or make a half_day_wfh.
        # For now, we override PRESENT to WFH.
        status_val = AttendanceStatus.WFH

    day.status = status_val
    day.punch_count = resolved.punch_count
    day.has_exception = resolved.has_exception
    day.exception_note = resolved.exception_note
    day.is_regularized = is_regularized
    day.computed_at = datetime.now(timezone.utc)

    db.flush()
    return day


def _aware(dt: datetime) -> datetime:
    """SQLite hands back naive datetimes. Postgres doesn't. Normalise."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def next_direction(db: Session, employee: Employee, shift_date: date) -> PunchDirection:
    """In or out? Whatever the last accepted punch wasn't."""
    policy, _ = policy_for(db, employee, shift_date)
    window_start = datetime.combine(
        shift_date - timedelta(days=1), time(0, 0), tzinfo=timezone.utc
    )
    window_end = datetime.combine(
        shift_date + timedelta(days=2), time(0, 0), tzinfo=timezone.utc
    )
    rows = db.scalars(
        select(PunchEvent)
        .where(
            and_(
                PunchEvent.employee_id == employee.id,
                PunchEvent.rejection_reason.is_(None),
                PunchEvent.event_ts_utc >= window_start,
                PunchEvent.event_ts_utc < window_end,
            )
        )
        .order_by(PunchEvent.event_ts_utc)
    ).all()
    today = [r for r in rows if shift_date_for(_aware(r.event_ts_utc), policy) == shift_date]
    if not today:
        return PunchDirection.IN
    # The docstring's rule, implemented as written. This used to count parity
    # instead, which agrees with the last punch only while the sequence
    # alternates perfectly - one explicit double-IN and the board reported
    # "not in" about someone who had just checked in. The resolver already
    # trusts an explicit direction over alternation; the live flag must too.
    last = today[-1]
    if last.direction == PunchDirection.IN:
        return PunchDirection.OUT
    if last.direction == PunchDirection.OUT:
        return PunchDirection.IN
    # Direction-less gate punches: alternation is all there is.
    return PunchDirection.OUT if len(today) % 2 == 1 else PunchDirection.IN
