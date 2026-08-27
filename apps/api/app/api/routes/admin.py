"""What HR looks at.

The board is computed, not stored: every request recomputes the day from raw
punches. At 60 employees that is a handful of milliseconds and it means the
screen can never drift from the evidence. When that stops being cheap, cache
it - do not start hand-maintaining it.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import org_today
from app.api.deps import RANK, require_role
from app.db.session import get_db
from app.models.attendance import PunchEvent
from app.models.auth import RefreshSession
from app.models.employee import Employee, User
from app.models.enums import UserRole
from app.models.enums import PunchDirection, PunchSource
from app.models.org import Department, Organization
from app.services.attendance import (
    next_direction, policy_for, recompute_day, record_punch,
)
from app.services import devices, export
from app.services.resolver import shift_date_for

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_role(UserRole.MANAGER))],
)

# HR and above. Applied per-route rather than to the whole router because a
# manager legitimately needs the board - just not the whole company on it.
hr_only = Depends(require_role(UserRole.HR_ADMIN))


def visible_employees(db: Session, user: User) -> list[Employee]:
    """Who this account is allowed to see.

    A manager sees the people who report to them, and themselves. Anyone from
    hr_admin up sees everyone. Doing this in one place is the point: scattering
    the rule across each endpoint is how one of them ends up missing it.
    """
    everyone = db.scalars(
        select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.emp_code)
    ).all()
    if RANK.get(user.role, -1) >= RANK[UserRole.HR_ADMIN]:
        return list(everyone)
    return [
        e for e in everyone
        if e.manager_id == user.employee_id or e.id == user.employee_id
    ]


class BoardRow(BaseModel):
    employee_code: str
    full_name: str
    department: str | None
    shift_label: str
    status: str
    currently_in: bool
    first_in: datetime | None
    last_out: datetime | None
    worked_minutes: int
    late_minutes: int
    overtime_minutes: int
    punch_count: int
    has_exception: bool
    exception_note: str | None


class BoardSummary(BaseModel):
    present: int
    late: int
    absent: int
    on_leave: int
    weekly_off: int
    exceptions: int
    currently_in: int
    headcount: int


class BoardResponse(BaseModel):
    shift_date: date
    summary: BoardSummary
    rows: list[BoardRow]


class RejectedPunch(BaseModel):
    employee_code: str
    full_name: str
    at: datetime
    reason: str
    distance_m: float | None
    photo_key: str | None


class CorrectionRequest(BaseModel):
    employee_code: str
    shift_date: date
    at: datetime
    direction: PunchDirection
    reason: str
    # No `actor` field. Who made a correction is taken from the token, never
    # from the request body - an audit trail the caller gets to fill in for
    # itself is not an audit trail.


@router.get("/board", response_model=BoardResponse)
def board(
    on: date | None = Query(default=None, description="Shift date. Defaults to today."),
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.MANAGER)),
) -> BoardResponse:
    # Org-timezone today, NOT the UTC date: between 00:00 and 05:30 IST
    # those differ, and the board was defaulting to yesterday while punches
    # filed to today. See app/core/clock.py.
    day = on or org_today()
    rows: list[BoardRow] = []
    counts = {"present": 0, "late": 0, "absent": 0, "on_leave": 0,
              "weekly_off": 0, "exceptions": 0, "currently_in": 0}

    employees = visible_employees(db, user)

    for emp in employees:
        policy, _ = policy_for(db, emp, day)
        record = recompute_day(db, emp, day)
        in_now = next_direction(db, emp, day) == PunchDirection.OUT
        dept = db.get(Department, emp.department_id) if emp.department_id else None

        rows.append(BoardRow(
            employee_code=emp.emp_code,
            full_name=emp.full_name,
            department=dept.name if dept else None,
            shift_label=f"{policy.start_time:%H:%M}-{policy.end_time:%H:%M}",
            status=record.status.value,
            currently_in=in_now,
            first_in=record.first_in,
            last_out=record.last_out,
            worked_minutes=record.worked_minutes,
            late_minutes=record.late_minutes,
            overtime_minutes=record.overtime_minutes,
            punch_count=record.punch_count,
            has_exception=record.has_exception,
            exception_note=record.exception_note,
        ))

        if record.status.value in counts:
            counts[record.status.value] += 1
        if record.late_minutes > 0:
            counts["late"] += 1
        if record.has_exception:
            counts["exceptions"] += 1
        if in_now:
            counts["currently_in"] += 1

    db.commit()
    return BoardResponse(
        shift_date=day,
        summary=BoardSummary(headcount=len(employees), **counts),
        rows=rows,
    )


@router.get("/rejected", response_model=list[RejectedPunch])
def rejected(
    days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    _: User = hr_only,
) -> list[RejectedPunch]:
    """Punches that were refused.

    These never count towards hours, but they are the single most useful screen
    when someone says "the app wouldn't let me check in" - it shows exactly what
    happened and when.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    events = db.scalars(
        select(PunchEvent)
        .where(and_(PunchEvent.rejection_reason.isnot(None), PunchEvent.event_ts_utc >= since))
        .order_by(PunchEvent.event_ts_utc.desc())
    ).all()

    out: list[RejectedPunch] = []
    for e in events:
        emp = db.get(Employee, e.employee_id) if e.employee_id else None
        out.append(RejectedPunch(
            employee_code=emp.emp_code if emp else "unknown",
            full_name=emp.full_name if emp else "Unmatched punch",
            at=e.event_ts_utc,
            reason=e.rejection_reason or "",
            distance_m=float(e.distance_m) if e.distance_m is not None else None,
            photo_key=e.photo_key,
        ))
    return out


@router.get("/month")
def month(
    employee_code: str,
    year: int,
    month: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.MANAGER)),
) -> dict:
    emp = db.scalar(select(Employee).where(Employee.emp_code == employee_code))
    if emp is None:
        raise HTTPException(404, f"No employee with code {employee_code}")
    # 404 rather than 403 for someone outside your scope: a manager should not
    # be able to enumerate the company by watching which codes come back
    # "forbidden" and which come back "not found".
    if emp.id not in {e.id for e in visible_employees(db, user)}:
        raise HTTPException(404, f"No employee with code {employee_code}")

    _, last = calendar.monthrange(year, month)
    days = []
    totals = {"worked_minutes": 0, "present": 0, "half_day": 0, "absent": 0,
              "late_minutes": 0, "overtime_minutes": 0}

    for d in range(1, last + 1):
        on = date(year, month, d)
        rec = recompute_day(db, emp, on)
        days.append({
            "date": on.isoformat(),
            "weekday": on.strftime("%a"),
            "status": rec.status.value,
            "first_in": rec.first_in.isoformat() if rec.first_in else None,
            "last_out": rec.last_out.isoformat() if rec.last_out else None,
            "worked_minutes": rec.worked_minutes,
            "late_minutes": rec.late_minutes,
            "overtime_minutes": rec.overtime_minutes,
            "has_exception": rec.has_exception,
            "exception_note": rec.exception_note,
        })
        totals["worked_minutes"] += rec.worked_minutes
        totals["late_minutes"] += rec.late_minutes
        totals["overtime_minutes"] += rec.overtime_minutes
        if rec.status.value in totals:
            totals[rec.status.value] += 1

    db.commit()
    return {"employee_code": emp.emp_code, "full_name": emp.full_name,
            "year": year, "month": month, "days": days, "totals": totals}


@router.post("/correct")
def correct(
    body: CorrectionRequest, db: Session = Depends(get_db), _: User = hr_only,
) -> dict:
    """Add a missing punch.

    Note what this does NOT do: it does not edit anything. A correction is a new
    punch, marked MANUAL, carrying who asked for it and why. The original record
    stays exactly as it was, and the day is recomputed from the fuller set of
    facts. That is the difference between a system you can audit and one you
    have to take on faith.
    """
    emp = db.scalar(select(Employee).where(Employee.emp_code == body.employee_code))
    if emp is None:
        raise HTTPException(404, f"No employee with code {body.employee_code}")
    if not body.reason.strip():
        raise HTTPException(400, "A correction needs a reason")

    _, created = record_punch(
        db, org_id=emp.org_id, employee=emp, event_ts=body.at,
        source=PunchSource.MANUAL, direction=body.direction,
        geofence_ok=None, face_ok=None,
        raw={"correction": True, "reason": body.reason,
             "actor": _.email, "actor_user_id": str(_.id)},
    )
    day = recompute_day(db, emp, body.shift_date)
    db.commit()

    return {
        "created": created,
        "shift_date": body.shift_date.isoformat(),
        "status": day.status.value,
        "worked_minutes": day.worked_minutes,
        "has_exception": day.has_exception,
        "note": None if created else "That punch already existed - nothing changed",
    }


class DeviceRow(BaseModel):
    employee_code: str
    full_name: str
    bound: bool
    platform: str | None
    model: str | None
    last_seen_at: datetime | None


@router.get("/devices", response_model=list[DeviceRow])
def list_devices(db: Session = Depends(get_db), _: User = hr_only) -> list[DeviceRow]:
    rows = []
    for emp in db.scalars(
        select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.emp_code)
    ).all():
        d = devices.active_binding(db, emp)
        rows.append(DeviceRow(
            employee_code=emp.emp_code, full_name=emp.full_name,
            bound=d is not None,
            platform=d.platform if d else None,
            model=d.model if d else None,
            last_seen_at=d.last_seen_at if d else None,
        ))
    return rows


@router.delete("/devices/{employee_code}")
def clear_device(
    employee_code: str, db: Session = Depends(get_db), _: User = hr_only,
) -> dict:
    """Unbind someone's phone so they can set up a new handset.

    This is the escape hatch that makes binding acceptable to live with. It
    deactivates the binding and signs out that phone's sessions, so a lost
    handset cannot keep refreshing its way back in.
    """
    emp = db.scalar(select(Employee).where(Employee.emp_code == employee_code))
    if emp is None:
        raise HTTPException(404, f"No employee with code {employee_code}")

    device = devices.active_binding(db, emp)
    if device is None:
        raise HTTPException(404, f"{employee_code} has no phone registered")

    install_id = device.install_id
    devices.clear(db, emp)

    now = datetime.now(timezone.utc)
    signed_out = 0
    for session in db.scalars(
        select(RefreshSession).where(
            RefreshSession.install_id == install_id,
            RefreshSession.revoked_at.is_(None),
        )
    ).all():
        session.revoked_at = now
        signed_out += 1

    db.commit()
    return {
        "cleared": True,
        "employee_code": employee_code,
        "sessions_signed_out": signed_out,
        "note": "They can register a new phone by signing in on it",
    }


@router.get("/export/month.csv")
def export_month(
    year: int = Query(...),
    month: int = Query(ge=1, le=12),
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.MANAGER)),
) -> Response:
    """The month-end register, as a file. One click.

    Scoped like the board: a manager exports their own reports, HR exports
    everyone. The filename carries the month so a folder of these stays
    readable a year later.
    """
    employees = visible_employees(db, user)
    rows = export.build(db, employees=employees, year=year, month=month)
    org = db.get(Organization, user.org_id)
    body = export.to_csv(
        rows, year=year, month=month, org_name=org.name if org else "Boxcode",
    )
    db.commit()

    name = f"attendance-{year}-{month:02d}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )
