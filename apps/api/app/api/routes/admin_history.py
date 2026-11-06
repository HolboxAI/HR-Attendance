from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.org import Organization
from app.models.attendance import AttendanceDay
from app.models.enums import UserRole, AttendanceStatus
from app.api.routes.admin import visible_employees
from app.services import export
from app.services.attendance import policy_for, recompute_day
from app.services.attendance_adjust import (
    clock_on, display_columns, latest_for, record_adjustment,
)

router = APIRouter(prefix="/admin/history", tags=["history-admin"])
manager_only = Depends(require_role(UserRole.MANAGER))
hr_only = Depends(require_role(UserRole.HR_ADMIN))

class HistoryOverview(BaseModel):
    present: int
    absent: int
    leave: int
    wfh: int
    corrections: int
    exceptions: int
    late: int

class HistoryRow(BaseModel):
    employee_code: str
    full_name: str
    department: str | None
    shift_date: date
    status: str
    first_in: datetime | None
    last_out: datetime | None
    worked_minutes: int
    break_minutes: int = 0
    late_minutes: int
    punch_count: int
    has_exception: bool
    exception_note: str | None
    is_regularized: bool
    overtime_minutes: int = 0
    extra_str: str = "—"
    shift_allotted: str = "—"
    break_windows: str = "—"
    punctuality: str = "—"
    regularised_by: str = "N/A"
    leave_status: str = "N/A"
    leave_approved_by: str = "N/A"
    remarks: str = "—"
    changed_by: str | None = None
    previous_status: str | None = None
    adjustment_reason: str | None = None


class AdjustRequest(BaseModel):
    employee_code: str
    shift_date: date
    status: str
    first_in: str | None = None
    last_out: str | None = None
    reason: str
    leave_type_code: str | None = None

@router.get("/overview", response_model=HistoryOverview)
def overview(
    start_date: date,
    end_date: date,
    employee_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = manager_only,
) -> HistoryOverview:
    employees = visible_employees(db, user)
    if employee_code:
        employees = [e for e in employees if e.emp_code == employee_code]
    
    emp_ids = [e.id for e in employees]
    if not emp_ids:
        return HistoryOverview(
            present=0, absent=0, leave=0, wfh=0, corrections=0, exceptions=0, late=0
        )

    days = db.scalars(
        select(AttendanceDay)
        .where(
            and_(
                AttendanceDay.employee_id.in_(emp_ids),
                AttendanceDay.shift_date >= start_date,
                AttendanceDay.shift_date <= end_date,
            )
        )
    ).all()
    adjustments = latest_for(db, emp_ids, start_date, end_date)

    out = HistoryOverview(
        present=0, absent=0, leave=0, wfh=0, corrections=0, exceptions=0, late=0
    )

    for day in days:
        edited = adjustments.get((day.employee_id, day.shift_date))
        status = edited.status if edited is not None else day.status
        if status == AttendanceStatus.PRESENT or status == "present":
            out.present += 1
        elif status == AttendanceStatus.ABSENT or status == "absent":
            out.absent += 1
        elif status in (AttendanceStatus.ON_LEAVE, AttendanceStatus.HALF_DAY, "on_leave", "half_day"):
            out.leave += 1
        elif status == AttendanceStatus.WFH or status == "wfh":
            out.wfh += 1

        if day.is_regularized or edited is not None:
            out.corrections += 1
        if day.has_exception:
            out.exceptions += 1
        if day.late_minutes > 0:
            out.late += 1

    return out

@router.get("/attendance", response_model=list[HistoryRow])
def attendance_list(
    start_date: date,
    end_date: date,
    employee_code: Optional[str] = None,
    status: Optional[str] = None,
    late_only: bool = False,
    regularized_only: bool = False,
    exception_only: bool = False,
    db: Session = Depends(get_db),
    user: User = manager_only,
) -> list[HistoryRow]:
    employees = visible_employees(db, user)
    if employee_code:
        employees = [e for e in employees if e.emp_code == employee_code]
        
    emp_map = {e.id: e for e in employees}
    emp_ids = list(emp_map.keys())
    if not emp_ids:
        return []

    query = select(AttendanceDay).where(
        and_(
            AttendanceDay.employee_id.in_(emp_ids),
            AttendanceDay.shift_date >= start_date,
            AttendanceDay.shift_date <= end_date,
        )
    ).order_by(AttendanceDay.shift_date.desc())

    days = db.scalars(query).all()
    adjustments = latest_for(db, emp_ids, start_date, end_date)

    rows = []
    for day in days:
        emp = emp_map[day.employee_id]
        edited = adjustments.get((day.employee_id, day.shift_date))
        policy, _ = policy_for(db, emp, day.shift_date)
        timing = f"{policy.start_time:%H:%M} - {policy.end_time:%H:%M}"
        shown = display_columns(db, emp, day, edited, timing)
        if status and shown["status"] != status:
            continue
        if late_only and shown["late_minutes"] <= 0:
            continue
        if regularized_only and not shown["is_regularized"]:
            continue
        if exception_only and not shown["has_exception"]:
            continue

        rows.append(HistoryRow(
            employee_code=emp.emp_code,
            full_name=emp.full_name,
            department=shown["department"] if shown["department"] != "—" else None,
            shift_date=day.shift_date,
            status=shown["status"],
            first_in=shown["first_in"],
            last_out=shown["last_out"],
            worked_minutes=shown["worked_minutes"],
            break_minutes=shown["break_minutes"] or 0,
            late_minutes=shown["late_minutes"],
            punch_count=shown["punch_count"],
            has_exception=shown["has_exception"],
            exception_note=shown["exception_note"],
            is_regularized=shown["is_regularized"],
            overtime_minutes=shown["overtime_minutes"],
            extra_str=shown["extra_str"],
            shift_allotted=shown["shift_allotted"],
            break_windows=shown["break_windows"],
            punctuality=shown["punctuality"],
            regularised_by=shown["regularised_by"],
            leave_status=shown["leave_status"],
            leave_approved_by=shown["leave_approved_by"],
            remarks=shown["remarks"],
            changed_by=shown["changed_by"],
            previous_status=shown["previous_status"],
            adjustment_reason=shown["adjustment_reason"],
        ))

    return rows


@router.post("/attendance/adjust", response_model=HistoryRow)
def adjust_attendance(
    body: AdjustRequest,
    db: Session = Depends(get_db),
    user: User = hr_only,
) -> HistoryRow:
    """Change the status and clock times a day shows. Punches are not touched.

    Worked hours stay the total already computed from those punches. The
    reason is required, and the previous edit is kept.
    """
    emp = db.scalar(select(Employee).where(Employee.emp_code == body.employee_code))
    if emp is None or emp.id not in {e.id for e in visible_employees(db, user, include_inactive=True)}:
        raise HTTPException(404, f"No employee with code {body.employee_code}")
    try:
        first_in = clock_on(body.shift_date, body.first_in)
        last_out = clock_on(body.shift_date, body.last_out)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    if not body.reason or not body.reason.strip():
        raise HTTPException(400, "A reason is mandatory for any attendance adjustment.")

    day = recompute_day(db, emp, body.shift_date)
    try:
        record_adjustment(
            db,
            actor=user,
            employee=emp,
            shift_date=body.shift_date,
            status=body.status,
            first_in=first_in,
            last_out=last_out,
            reason=body.reason,
            day=day,
            leave_type_code=body.leave_type_code,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()

    rows = attendance_list(
        start_date=body.shift_date,
        end_date=body.shift_date,
        employee_code=emp.emp_code,
        db=db,
        user=user,
    )
    match = next((row for row in rows if row.shift_date == body.shift_date), None)
    if match is None:
        raise HTTPException(500, "The edit was saved but the day could not be read back")
    return match


@router.get("/attendance/export.pdf")
def export_attendance_history_pdf(
    start_date: date,
    end_date: date,
    employee_code: Optional[str] = None,
    status: Optional[str] = None,
    late_only: bool = False,
    regularized_only: bool = False,
    exception_only: bool = False,
    db: Session = Depends(get_db),
    user: User = manager_only,
) -> Response:
    s_date = min(start_date, end_date)
    e_date = max(start_date, end_date)

    rows = attendance_list(
        start_date=s_date,
        end_date=e_date,
        employee_code=employee_code,
        status=status,
        late_only=late_only,
        regularized_only=regularized_only,
        exception_only=exception_only,
        db=db,
        user=user,
    )

    org = db.get(Organization, user.org_id) if user.org_id else None
    org_name = org.name if org else "Holbox AI"

    filter_parts = []
    if employee_code:
        filter_parts.append(f"Employee: {employee_code}")
    if status:
        filter_parts.append(f"Status: {status.replace('_', ' ').title()}")
    if late_only:
        filter_parts.append("Late Only")
    if regularized_only:
        filter_parts.append("Corrections Only")
    if exception_only:
        filter_parts.append("Exceptions Only")
    filters_desc = " | ".join(filter_parts) if filter_parts else "All Records"

    pdf_bytes = export.attendance_history_to_pdf(
        rows=[r.model_dump() for r in rows],
        start_date=s_date,
        end_date=e_date,
        org_name=org_name,
        filters_desc=filters_desc,
    )

    filename = f"attendance_history_{s_date.isoformat()}_{e_date.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/attendance/export.csv")
def export_attendance_history_csv(
    start_date: date,
    end_date: date,
    employee_code: Optional[str] = None,
    status: Optional[str] = None,
    late_only: bool = False,
    regularized_only: bool = False,
    exception_only: bool = False,
    db: Session = Depends(get_db),
    user: User = manager_only,
) -> Response:
    s_date = min(start_date, end_date)
    e_date = max(start_date, end_date)

    rows = attendance_list(
        start_date=s_date,
        end_date=e_date,
        employee_code=employee_code,
        status=status,
        late_only=late_only,
        regularized_only=regularized_only,
        exception_only=exception_only,
        db=db,
        user=user,
    )

    org = db.get(Organization, user.org_id) if user.org_id else None
    org_name = org.name if org else "Holbox AI"

    filter_parts = []
    if employee_code:
        filter_parts.append(f"Employee: {employee_code}")
    if status:
        filter_parts.append(f"Status: {status.replace('_', ' ').title()}")
    if late_only:
        filter_parts.append("Late Only")
    if regularized_only:
        filter_parts.append("Corrections Only")
    if exception_only:
        filter_parts.append("Exceptions Only")
    filters_desc = " | ".join(filter_parts) if filter_parts else "All Records"

    csv_text = export.attendance_history_to_csv(
        rows=[r.model_dump() for r in rows],
        start_date=s_date,
        end_date=e_date,
        org_name=org_name,
        filters_desc=filters_desc,
    )

    filename = f"attendance_history_{s_date.isoformat()}_{e_date.isoformat()}.csv"
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
