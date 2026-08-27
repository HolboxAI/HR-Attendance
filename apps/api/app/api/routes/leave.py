"""What an employee can do with their own leave.

Everything here is scoped to the caller by the token. There is deliberately no
employee parameter on any of it - the same rule the auth milestone established
for punching applies just as well to booking time off.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, get_current_user
from app.core.clock import org_today
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import LeaveStatus
from app.models.leave import LeaveRequest, LeaveType
from app.services import leave as leave_service

router = APIRouter(prefix="/leave", tags=["leave"])


class LeaveTypeOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    annual_quota: float
    is_paid: bool
    requires_proof: bool
    carries_forward: bool


class BalanceOut(BaseModel):
    leave_type_id: uuid.UUID
    code: str
    name: str
    is_paid: bool
    period: str
    opening: float
    accrued: float
    used: float
    available: float


class RequestOut(BaseModel):
    id: uuid.UUID
    leave_type_code: str
    leave_type_name: str
    from_date: date
    to_date: date
    half_day_start: bool
    half_day_end: bool
    days: float
    status: str
    reason: str | None
    decided_note: str | None
    decided_at: datetime | None
    employee_code: str | None = None
    employee_name: str | None = None


class ApplyRequest(BaseModel):
    leave_type_code: str
    from_date: date
    to_date: date
    half_day_start: bool = False
    half_day_end: bool = False
    reason: str | None = None


def _types(db: Session, org_id: uuid.UUID) -> list[LeaveType]:
    return list(db.scalars(
        select(LeaveType)
        .where(LeaveType.org_id == org_id, LeaveType.is_active.is_(True),
               LeaveType.deleted_at.is_(None))
        .order_by(LeaveType.sort_order, LeaveType.code)
    ).all())


def to_request_out(db: Session, r: LeaveRequest, emp: Employee | None = None) -> RequestOut:
    lt = db.get(LeaveType, r.leave_type_id)
    emp = emp or db.get(Employee, r.employee_id)
    return RequestOut(
        id=r.id, leave_type_code=lt.code if lt else "?",
        leave_type_name=lt.name if lt else "?",
        from_date=r.from_date, to_date=r.to_date,
        half_day_start=r.half_day_start, half_day_end=r.half_day_end,
        days=float(r.days_consumed), status=r.status.value,
        reason=r.reason, decided_note=r.decided_note, decided_at=r.decided_at,
        employee_code=emp.emp_code if emp else None,
        employee_name=emp.full_name if emp else None,
    )


@router.get("/types", response_model=list[LeaveTypeOut])
def types(db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee)):
    return [
        LeaveTypeOut(
            id=t.id, code=t.code, name=t.name, annual_quota=float(t.annual_quota),
            is_paid=t.is_paid, requires_proof=t.requires_proof,
            carries_forward=t.carries_forward,
        )
        for t in _types(db, emp.org_id)
    ]


@router.get("/balance", response_model=list[BalanceOut])
def my_balance(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
):
    pol = leave_service.policy(db, emp.org_id)
    period = leave_service.period_for(pol, org_today())
    out = []
    for t in _types(db, emp.org_id):
        bal = leave_service.balance(db, emp, t, period)
        out.append(BalanceOut(
            leave_type_id=t.id, code=t.code, name=t.name, is_paid=t.is_paid,
            period=period, opening=float(bal.opening), accrued=float(bal.accrued),
            used=float(bal.used), available=bal.available,
        ))
    db.commit()
    return out


@router.get("/my-requests", response_model=list[RequestOut])
def my_requests(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
):
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.employee_id == emp.id, LeaveRequest.deleted_at.is_(None))
        .order_by(LeaveRequest.from_date.desc())
    ).all()
    return [to_request_out(db, r, emp) for r in rows]


@router.post("/request", response_model=RequestOut)
def apply(
    body: ApplyRequest,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
):
    lt = db.scalar(select(LeaveType).where(
        LeaveType.org_id == emp.org_id, LeaveType.code == body.leave_type_code.upper(),
        LeaveType.is_active.is_(True), LeaveType.deleted_at.is_(None),
    ))
    if lt is None:
        raise HTTPException(404, f"No leave type {body.leave_type_code}")

    result = leave_service.submit(
        db, employee=emp, leave_type=lt, start=body.from_date, end=body.to_date,
        reason=body.reason, half_day_start=body.half_day_start,
        half_day_end=body.half_day_end,
    )
    if not result.ok:
        db.rollback()
        # 409, not 400: the request is well-formed, it conflicts with the state
        # of the world - a balance that ran out, or a range already booked.
        raise HTTPException(409, result.reason or "Could not apply")

    db.commit()
    return to_request_out(db, result.request, emp)


@router.post("/{request_id}/cancel", response_model=RequestOut)
def cancel(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
    user: User = Depends(get_current_user),
):
    row = db.get(LeaveRequest, request_id)
    # 404 rather than 403 for someone else's request, so the endpoint cannot be
    # used to discover which request ids exist.
    if row is None or row.employee_id != emp.id or row.deleted_at is not None:
        raise HTTPException(404, "No such request")

    result = leave_service.cancel(db, request=row, actor=user)
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not cancel")
    db.commit()
    return to_request_out(db, row, emp)
