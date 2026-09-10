"""Admin endpoints for reviewing, approving, and rejecting employee signup requests."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.admin_employees import EmployeeOut, to_out
from app.db.session import get_db
from app.models.attendance import ShiftTemplate
from app.models.employee import Employee, User
from app.models.enums import SignupStatus, UserRole
from app.models.org import Department
from app.models.signup_request import SignupRequest
from app.services import employees as employee_service
from app.services.notifications import resolve_matching

router = APIRouter(prefix="/admin/signups", tags=["signups"])

hr_only = Depends(require_role(UserRole.HR_ADMIN))


class SignupRequestOut(BaseModel):
    id: str
    full_name: str
    email: str
    phone: str | None
    desired_department: str | None
    desired_designation: str | None
    status: str
    created_at: str


class SignupsListResponse(BaseModel):
    requests: list[SignupRequestOut]
    suggested_emp_code: str
    departments: list[str]
    shifts: list[str]


class ApproveSignupIn(BaseModel):
    emp_code: str = Field(min_length=1, max_length=32)
    department: str | None = None
    designation: str | None = None
    shift: str | None = None
    manager_code: str | None = None
    date_of_joining: date | None = None
    role: UserRole = UserRole.EMPLOYEE


class RejectSignupIn(BaseModel):
    reason: str | None = None


class DecisionResponse(BaseModel):
    ok: bool
    message: str
    employee: EmployeeOut | None = None


@router.get("", response_model=SignupsListResponse)
def list_pending_signups(
    db: Session = Depends(get_db),
    actor: User = hr_only,
) -> SignupsListResponse:
    """List pending signup requests with metadata needed for approval modal."""
    rows = db.scalars(
        select(SignupRequest)
        .where(
            SignupRequest.org_id == actor.org_id,
            SignupRequest.status == SignupStatus.PENDING,
        )
        .order_by(SignupRequest.created_at.desc())
    ).all()

    departments = [
        d.name for d in db.scalars(
            select(Department).where(Department.org_id == actor.org_id).order_by(Department.name)
        ).all()
    ]

    shifts = [
        s.name for s in db.scalars(
            select(ShiftTemplate).where(ShiftTemplate.org_id == actor.org_id).order_by(ShiftTemplate.name)
        ).all()
    ]

    suggested_code = employee_service.suggest_next_employee_code(db, actor.org_id)

    return SignupsListResponse(
        requests=[
            SignupRequestOut(
                id=str(r.id),
                full_name=r.full_name,
                email=r.email,
                phone=r.phone,
                desired_department=r.desired_department,
                desired_designation=r.desired_designation,
                status=r.status.value,
                created_at=r.created_at.isoformat() if r.created_at else "",
            )
            for r in rows
        ],
        suggested_emp_code=suggested_code,
        departments=departments,
        shifts=shifts,
    )


@router.post("/{signup_id}/approve", response_model=DecisionResponse)
def approve_signup(
    signup_id: str,
    body: ApproveSignupIn,
    db: Session = Depends(get_db),
    actor: User = hr_only,
) -> DecisionResponse:
    """Approve a signup request, creating the employee and user account with their supplied password."""
    try:
        req_uuid = uuid.UUID(signup_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid signup request ID")

    req = db.get(SignupRequest, req_uuid)
    if req is None or req.org_id != actor.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signup request not found")

    if req.status != SignupStatus.PENDING:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"This signup request is already {req.status.value}",
        )

    # Call employee create with password_hash preserved
    result = employee_service.create(
        db,
        org_id=actor.org_id,
        actor=actor,
        emp_code=body.emp_code,
        full_name=req.full_name,
        email=req.email,
        phone=req.phone,
        department=body.department or req.desired_department,
        designation=body.designation or req.desired_designation,
        shift=body.shift,
        manager_code=body.manager_code,
        date_of_joining=body.date_of_joining,
        role=body.role,
        password_hash=req.password_hash,
    )

    if not result.ok or result.employee is None:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, result.reason or "Could not create employee")

    req.status = SignupStatus.APPROVED
    req.decided_by_id = actor.id
    req.decided_at = datetime.now(timezone.utc)
    req.created_employee_id = result.employee.id
    db.flush()

    # Clear matching admin notifications
    resolve_matching(
        db,
        org_id=actor.org_id,
        category="employee.signup_request",
        data_key="signup_id",
        data_value=str(req.id),
    )

    db.commit()

    return DecisionResponse(
        ok=True,
        message=f"{result.employee.full_name} ({result.employee.emp_code}) has been approved and added to workforce.",
        employee=to_out(db, result.employee),
    )


@router.post("/{signup_id}/reject", response_model=DecisionResponse)
def reject_signup(
    signup_id: str,
    body: RejectSignupIn,
    db: Session = Depends(get_db),
    actor: User = hr_only,
) -> DecisionResponse:
    """Reject a signup request."""
    try:
        req_uuid = uuid.UUID(signup_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid signup request ID")

    req = db.get(SignupRequest, req_uuid)
    if req is None or req.org_id != actor.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Signup request not found")

    if req.status != SignupStatus.PENDING:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"This signup request is already {req.status.value}",
        )

    req.status = SignupStatus.REJECTED
    req.decided_by_id = actor.id
    req.decided_at = datetime.now(timezone.utc)
    req.rejection_reason = body.reason
    db.flush()

    # Clear matching admin notifications
    resolve_matching(
        db,
        org_id=actor.org_id,
        category="employee.signup_request",
        data_key="signup_id",
        data_value=str(req.id),
    )

    db.commit()

    return DecisionResponse(
        ok=True,
        message="Registration request rejected.",
    )
