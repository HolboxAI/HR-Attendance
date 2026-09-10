from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.org import Department, Organization
from app.models.attendance import AttendanceDay
from app.models.enums import UserRole, AttendanceStatus
from app.core.clock import org_today
from app.api.routes.admin import visible_employees
from app.services import export

router = APIRouter(prefix="/admin/history", tags=["history-admin"])
manager_only = Depends(require_role(UserRole.MANAGER))

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
    late_minutes: int
    punch_count: int
    has_exception: bool
    exception_note: str | None
    is_regularized: bool

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
    
    out = HistoryOverview(
        present=0, absent=0, leave=0, wfh=0, corrections=0, exceptions=0, late=0
    )
    
    for day in days:
        if day.status == AttendanceStatus.PRESENT:
            out.present += 1
        elif day.status == AttendanceStatus.ABSENT:
            out.absent += 1
        elif day.status in (AttendanceStatus.ON_LEAVE, AttendanceStatus.HALF_DAY):
            out.leave += 1
        elif day.status == AttendanceStatus.WFH:
            out.wfh += 1
            
        if day.is_regularized:
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
    
    query = select(AttendanceDay).where(
        and_(
            AttendanceDay.employee_id.in_(emp_ids),
            AttendanceDay.shift_date >= start_date,
            AttendanceDay.shift_date <= end_date,
        )
    ).order_by(AttendanceDay.shift_date.desc())
    
    days = db.scalars(query).all()
    
    # Batch fetch departments
    dept_ids = {e.department_id for e in employees if e.department_id}
    depts = db.scalars(select(Department).where(Department.id.in_(dept_ids))).all() if dept_ids else []
    dept_map = {d.id: d.name for d in depts}
    
    rows = []
    for day in days:
        if status and day.status.value != status:
            continue
        if late_only and day.late_minutes <= 0:
            continue
        if regularized_only and not day.is_regularized:
            continue
        if exception_only and not day.has_exception:
            continue
            
        emp = emp_map[day.employee_id]
        dept_name = dept_map.get(emp.department_id) if emp.department_id else None
        
        rows.append(HistoryRow(
            employee_code=emp.emp_code,
            full_name=emp.full_name,
            department=dept_name,
            shift_date=day.shift_date,
            status=day.status.value,
            first_in=day.first_in,
            last_out=day.last_out,
            worked_minutes=day.worked_minutes,
            late_minutes=day.late_minutes,
            punch_count=day.punch_count,
            has_exception=day.has_exception,
            exception_note=day.exception_note,
            is_regularized=day.is_regularized,
        ))
        
    return rows


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
