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
from app.models.employee import User
from app.models.enums import CorrectionStatus, UserRole
from app.services import corrections as correction_service

router = APIRouter(prefix="/admin/corrections", tags=["corrections-admin"])
hr_only = Depends(require_role(UserRole.HR_ADMIN))


class DecideRequest(BaseModel):
    approve: bool
    note: str | None = None


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
    return to_out(db, row)
