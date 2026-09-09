"""HR's queue for correction requests.

hr_only for both listing and deciding, on your call: nobody has a manager_id
set in the seed yet, so a manager tier would mean nobody could approve
anything. The shape below matches admin_leave.py's approver/hr_only split
closely enough that adding a manager tier later is swapping one dependency,
not a rewrite.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.corrections import RequestOut, to_out
from app.db.session import get_db
from app.models.correction import CorrectionRequest
from app.models.employee import Employee, User
from app.core.clock import org_today
from app.models.enums import CorrectionStatus, UserRole
from app.services import corrections as correction_service

router = APIRouter(prefix="/admin/corrections", tags=["corrections-admin"])
hr_only = Depends(require_role(UserRole.HR_ADMIN))


class DecideRequest(BaseModel):
    approve: bool
    note: str | None = None


class EmployeeCorrectionSummary(BaseModel):
    employee_code: str
    employee_name: str
    correction_limit: int
    used_corrections: int
    requests: list[RequestOut]


@router.get("/pending", response_model=list[RequestOut])
def pending(db: Session = Depends(get_db), _: User = hr_only):
    rows = db.scalars(
        select(CorrectionRequest)
        .where(CorrectionRequest.status == CorrectionStatus.PENDING,
               CorrectionRequest.deleted_at.is_(None))
        .order_by(CorrectionRequest.shift_date)
    ).all()
    return [to_out(db, r) for r in rows]


@router.post("/{request_id}/decide", response_model=RequestOut)
def decide(
    request_id: uuid.UUID, body: DecideRequest,
    db: Session = Depends(get_db), user: User = hr_only,
):
    row = db.get(CorrectionRequest, request_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(404, "No such request")

    result = correction_service.decide(
        db, request=row, actor=user, approve=body.approve, note=body.note,
    )
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not decide")
    db.commit()
    return to_out(db, result.request)


@router.get("/summary", response_model=list[EmployeeCorrectionSummary])
def summary(db: Session = Depends(get_db), _: User = hr_only):
    today = org_today()
    month_start = today.replace(day=1)
    if month_start.month == 12:
        month_end = today.replace(year=today.year + 1, month=1, day=1)
    else:
        month_end = today.replace(month=today.month + 1, day=1)
        
    employees = db.scalars(select(Employee).where(Employee.is_active == True)).all()
    
    requests = db.scalars(
        select(CorrectionRequest)
        .where(CorrectionRequest.deleted_at.is_(None))
        .order_by(CorrectionRequest.shift_date.desc())
    ).all()
    
    reqs_by_emp = {}
    for r in requests:
        reqs_by_emp.setdefault(r.employee_id, []).append(r)
        
    summaries = []
    for emp in employees:
        emp_reqs = reqs_by_emp.get(emp.id, [])
        used = sum(
            1 for r in emp_reqs 
            if r.shift_date >= month_start and r.shift_date < month_end 
            and r.status.value in ("pending", "approved")
        )
        if len(emp_reqs) > 0:
            summaries.append(
                EmployeeCorrectionSummary(
                    employee_code=emp.emp_code,
                    employee_name=emp.full_name,
                    correction_limit=emp.correction_limit if emp.correction_limit is not None else 5,
                    used_corrections=used,
                    requests=[to_out(db, r, emp) for r in emp_reqs]
                )
            )
            
    # Sort by used corrections descending
    summaries.sort(key=lambda s: s.used_corrections, reverse=True)
    return summaries
