"""Save and read the dates someone says they will not come.

Past dates stay as they were. Today and later, in the month being edited,
follow whatever the person just sent.
"""

from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.planned_absence import PlannedAbsence


def month_bounds(year: int, month: int) -> tuple[date, date]:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def horizon_end(as_of: date) -> date:
    """Last day of next month. A notice saved on the 30th still shows up."""
    year = as_of.year + (1 if as_of.month == 12 else 0)
    month = 1 if as_of.month == 12 else as_of.month + 1
    year2 = year + (1 if month == 12 else 0)
    month2 = 1 if month == 12 else month + 1
    return date(year2, month2, 1) - timedelta(days=1)


def dates_to_apply(wanted: set[date], *, year: int, month: int, today: date) -> set[date]:
    """Keep only today-or-later dates that sit inside the month being saved."""
    start, end = month_bounds(year, month)
    return {d for d in wanted if start <= d <= end and d >= today}


def list_month(db: Session, employee_id: uuid.UUID, year: int, month: int) -> list[date]:
    start, end = month_bounds(year, month)
    rows = db.scalars(
        select(PlannedAbsence).where(
            PlannedAbsence.employee_id == employee_id,
            PlannedAbsence.absent_on >= start,
            PlannedAbsence.absent_on <= end,
            PlannedAbsence.deleted_at.is_(None),
        ).order_by(PlannedAbsence.absent_on)
    ).all()
    return [row.absent_on for row in rows]


def replace_month(
    db: Session,
    *,
    org_id: uuid.UUID,
    employee_id: uuid.UUID,
    year: int,
    month: int,
    wanted: set[date],
    today: date,
) -> list[date]:
    """Sync this month's future dates to `wanted`. Past rows are left alone."""
    start, end = month_bounds(year, month)
    keep = dates_to_apply(wanted, year=year, month=month, today=today)
    existing = db.scalars(
        select(PlannedAbsence).where(
            PlannedAbsence.employee_id == employee_id,
            PlannedAbsence.absent_on >= start,
            PlannedAbsence.absent_on <= end,
        )
    ).all()
    now = datetime.now(timezone.utc)
    seen: set[date] = set()
    for row in existing:
        seen.add(row.absent_on)
        if row.absent_on < today:
            continue
        if row.absent_on in keep:
            row.deleted_at = None
        elif row.deleted_at is None:
            row.deleted_at = now
    for day in sorted(keep - seen):
        db.add(PlannedAbsence(
            id=uuid.uuid4(),
            org_id=org_id,
            employee_id=employee_id,
            absent_on=day,
        ))
    db.flush()
    return list_month(db, employee_id, year, month)


def _leave_decision_label(db: Session, lr) -> str:
    """Human line for one leave request: status + who decided + reason."""
    from app.models.employee import User

    raw = lr.status.value if hasattr(lr.status, "value") else str(lr.status)
    status_key = str(raw).lower().replace("leavestatus.", "")
    status_l = status_key.replace("_", " ")

    actor = None
    if lr.approver_id:
        u = db.get(User, lr.approver_id)
        if u:
            actor = (u.email or "").split("@")[0] or None
            if u.employee_id:
                from app.models.employee import Employee as Emp
                ae = db.get(Emp, u.employee_id)
                if ae and ae.full_name:
                    actor = ae.full_name

    reason = (lr.reason or "").strip()
    if reason and len(reason) > 140:
        reason = reason[:137] + "…"
    admin_note = (lr.decided_note or "").strip()
    if admin_note and len(admin_note) > 100:
        admin_note = admin_note[:97] + "…"

    if status_key in ("approved", "rejected", "partially_approved"):
        who = f" by {actor}" if actor else ""
        parts = [f"Leave {status_l}{who}"]
        if reason:
            parts.append(f"reason: {reason}")
        if admin_note and not admin_note.lower().startswith("decided via"):
            # Skip boilerplate "Decided via Slack by @x" — actor already shown.
            parts.append(f"note: {admin_note}")
        return " — ".join(parts)
    # Pending / other
    if reason:
        return f"Leave {status_l} (awaiting decision) — reason: {reason}"
    return f"Leave {status_l} (awaiting decision)"


def notice_roster(db: Session, org_id: uuid.UUID, as_of: date) -> list[dict]:
    """Active employees who have leave or an advance notice from today forward.

    People with nothing scheduled are omitted (e.g. Krish stays off the mail).
    Includes:
    - Advance notices
    - Leave applications (pending / approved / partial / rejected; not cancelled)
      with decision actor + reason when decided.
    """
    from app.models.enums import LeaveStatus
    from app.models.leave import LeaveRequest

    end = horizon_end(as_of)
    employees = {
        e.id: e
        for e in db.scalars(
            select(Employee).where(
                Employee.org_id == org_id,
                Employee.is_active.is_(True),
                Employee.deleted_at.is_(None),
            )
        ).all()
    }
    rows = db.scalars(
        select(PlannedAbsence).where(
            PlannedAbsence.org_id == org_id,
            PlannedAbsence.absent_on >= as_of,
            PlannedAbsence.absent_on <= end,
            PlannedAbsence.deleted_at.is_(None),
        )
    ).all()
    # date -> list of detail strings
    by_emp: dict[uuid.UUID, dict[date, list[str]]] = {}
    for row in rows:
        by_emp.setdefault(row.employee_id, {}).setdefault(row.absent_on, []).append(
            "Advance notice"
        )

    leave_rows = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.org_id == org_id,
            LeaveRequest.to_date >= as_of,
            LeaveRequest.from_date <= end,
            LeaveRequest.deleted_at.is_(None),
            LeaveRequest.status != LeaveStatus.CANCELLED,
        )
    ).all()
    for lr in leave_rows:
        detail = _leave_decision_label(db, lr)
        day = max(lr.from_date, as_of)
        last = min(lr.to_date, end)
        while day <= last:
            by_emp.setdefault(lr.employee_id, {}).setdefault(day, []).append(detail)
            day += timedelta(days=1)

    people = []
    for emp_id, day_map in by_emp.items():
        emp = employees.get(emp_id)
        if emp is None or not day_map:
            continue
        dates_fmt: list[str] = []
        for d in sorted(day_map.keys()):
            details = day_map[d]
            # Deduplicate while keeping order
            seen: set[str] = set()
            uniq = []
            for x in details:
                if x not in seen:
                    seen.add(x)
                    uniq.append(x)
            joined = "; ".join(uniq)
            dates_fmt.append(f"{d.strftime('%d %b')} — {joined}")
        people.append({
            "name": emp.full_name,
            "code": emp.emp_code,
            "dates": dates_fmt,
        })
    people.sort(key=lambda p: (p["name"] or "").lower())
    return people
