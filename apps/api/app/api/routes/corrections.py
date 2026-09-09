"""What an employee can do about their own flagged days.

Same shape as routes/leave.py: everything here is scoped to the caller by the
token, and there is no employee parameter anywhere - the punch-endpoint rule
applies just as well to "who is asking to fix a day".
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, get_current_user
from app.db.session import get_db
from app.models.correction import CorrectionRequest
from app.models.employee import Employee, User
from app.models.enums import PunchDirection
from app.services import corrections as correction_service

router = APIRouter(prefix="/corrections", tags=["corrections"])


class SubmitRequest(BaseModel):
    shift_date: date
    direction: PunchDirection
    claimed_at: datetime
    reason: str
    category: str = "missed_punch"


class RequestOut(BaseModel):
    id: uuid.UUID
    shift_date: date
    direction: str
    claimed_at: datetime
    reason: str
    category: str
    status: str
    decided_note: str | None
    decided_at: datetime | None
    employee_code: str | None = None
    employee_name: str | None = None


def to_out(db: Session, r: CorrectionRequest, emp: Employee | None = None) -> RequestOut:
    emp = emp or db.get(Employee, r.employee_id)
    return RequestOut(
        id=r.id, shift_date=r.shift_date, direction=r.direction.value,
        claimed_at=r.claimed_at, reason=r.reason, category=r.category, status=r.status.value,
        decided_note=r.decided_note, decided_at=r.decided_at,
        employee_code=emp.emp_code if emp else None,
        employee_name=emp.full_name if emp else None,
    )


@router.post("", response_model=RequestOut)
def submit(
    body: SubmitRequest,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
):
    result = correction_service.submit(
        db, employee=emp, shift_date=body.shift_date, direction=body.direction,
        claimed_at=body.claimed_at, reason=body.reason, category=body.category,
    )
    if not result.ok:
        db.rollback()
        # 409: the request is well-formed, it conflicts with existing state -
        # a duplicate pending request, or a day that has not happened yet.
        raise HTTPException(409, result.reason or "Could not submit")
    db.commit()
    return to_out(db, result.request, emp)


@router.get("/my-requests", response_model=list[RequestOut])
def my_requests(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
):
    rows = db.scalars(
        select(CorrectionRequest)
        .where(CorrectionRequest.employee_id == emp.id, CorrectionRequest.deleted_at.is_(None))
        .order_by(CorrectionRequest.shift_date.desc())
    ).all()
    return [to_out(db, r, emp) for r in rows]


@router.post("/{request_id}/cancel", response_model=RequestOut)
def cancel(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
    user: User = Depends(get_current_user),
):
    row = db.get(CorrectionRequest, request_id)
    if row is None or row.employee_id != emp.id or row.deleted_at is not None:
        raise HTTPException(404, "No such request")

    result = correction_service.cancel(db, request=row, actor=user)
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not cancel")
    db.commit()
    return to_out(db, row, emp)
