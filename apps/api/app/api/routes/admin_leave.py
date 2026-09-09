"""Approvals, the holiday calendar, and the policy HR owns.

Split from admin.py because that file is the attendance board. Two access
levels live here: approvers (manager and up) decide requests for people they
can see, and hr_admin owns the settings - quotas, accrual, carry-forward, the
sandwich rule, the backdating window, and the calendar.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.admin import visible_employees
from app.api.routes.leave import RequestOut, to_request_out
from app.core.clock import org_today
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import AccrualRule, LeaveStatus, UserRole
from app.models.leave import AuditLog, Holiday, LeaveRequest, LeaveType
from app.services import leave as leave_service

router = APIRouter(prefix="/admin", tags=["leave-admin"])

# Approvers. A manager can decide for their own reports; HR sees everyone.
approver = Depends(require_role(UserRole.MANAGER))
# Settings. The brief is explicit that a plain employee - and a manager - must
# not reach these.
hr_only = Depends(require_role(UserRole.HR_ADMIN))


class DecideRequest(BaseModel):
    approve: bool
    partial_approve: bool = False
    medical_document_deadline: datetime | None = None
    note: str | None = None


class HolidayOut(BaseModel):
    id: uuid.UUID
    day: date
    name: str
    is_optional: bool
    is_confirmed: bool
    note: str | None


class HolidayIn(BaseModel):
    day: date
    name: str
    is_optional: bool = False
    is_confirmed: bool = True
    note: str | None = None


class PolicyOut(BaseModel):
    year_start_month: int
    sandwich_rule: bool
    backdate_days: int


class PolicyIn(BaseModel):
    year_start_month: int = Field(ge=1, le=12)
    sandwich_rule: bool
    backdate_days: int = Field(ge=0, le=365)


class TypeIn(BaseModel):
    code: str
    name: str
    annual_quota: float = Field(ge=0)
    accrual_rule: AccrualRule
    carries_forward: bool = False
    carry_cap: float = Field(default=0, ge=0)
    is_paid: bool = True
    requires_proof: bool = False
    is_active: bool = True


class TypeOut(TypeIn):
    id: uuid.UUID


class BalanceRow(BaseModel):
    employee_code: str
    full_name: str
    code: str
    period: str
    accrued: float
    used: float
    available: float


class AuditRow(BaseModel):
    at: datetime
    actor: str
    entity: str
    action: str
    changes: dict
    note: str | None


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------

@router.get("/leave/pending", response_model=list[RequestOut])
def pending(db: Session = Depends(get_db), user: User = approver):
    scope = {e.id: e for e in visible_employees(db, user)}
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.status.in_([LeaveStatus.PENDING, LeaveStatus.PARTIALLY_APPROVED]),
               LeaveRequest.deleted_at.is_(None))
        .order_by(LeaveRequest.from_date)
    ).all()
    # Your own request never appears in your own queue - you cannot decide it,
    # so showing it would only invite the attempt.
    return [
        to_request_out(db, r, scope[r.employee_id])
        for r in rows
        if r.employee_id in scope and r.employee_id != user.employee_id
    ]


@router.get("/leave/status", response_model=list[RequestOut])
def all_status(db: Session = Depends(get_db), user: User = approver):
    """View all leave requests for the leave status page."""
    scope = {e.id: e for e in visible_employees(db, user)}
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.deleted_at.is_(None))
        .order_by(LeaveRequest.from_date.desc())
    ).all()
    
    return [
        to_request_out(db, r, scope[r.employee_id])
        for r in rows
        if r.employee_id in scope
    ]


@router.post("/leave/{request_id}/decide", response_model=RequestOut)
def decide(
    request_id: uuid.UUID,
    body: DecideRequest,
    db: Session = Depends(get_db),
    user: User = approver,
):
    row = db.get(LeaveRequest, request_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(404, "No such request")
    if row.employee_id not in {e.id for e in visible_employees(db, user)}:
        raise HTTPException(404, "No such request")

    result = leave_service.decide(
        db, request=row, approver=user, approve=body.approve, 
        partial_approve=body.partial_approve, 
        medical_document_deadline=body.medical_document_deadline,
        note=body.note,
    )
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not decide")
    db.commit()
    
    emp = db.get(Employee, row.employee_id)
    if row.slack_message_ts and row.slack_channel_id:
        from app.services.slack import update_leave_request
        from threading import Thread
        leave_type = db.get(LeaveType, row.leave_type_id)
        
        # We need to construct the original text the bot posted
        orig_text = f"🌴 *Leave Request: {emp.full_name}*\nRequested *{float(row.days_consumed):g} days* of {leave_type.name} from {row.from_date} to {row.to_date}.\n> \"{row.reason or 'No reason provided'}\""
        
        # Fix: User doesn't have an 'employee' relationship, we must fetch the employee object
        approver_emp = db.get(Employee, user.employee_id) if user.employee_id else None
        approver_name = approver_emp.full_name if approver_emp else "admin"
        
        Thread(
            target=update_leave_request, 
            args=(row.slack_channel_id, row.slack_message_ts, orig_text, body.approve, approver_name),
            daemon=True
        ).start()
        
    return to_request_out(db, row, emp)


@router.get("/leave/balances", response_model=list[BalanceRow])
def balances(db: Session = Depends(get_db), user: User = approver):
    pol = leave_service.policy(db, user.org_id)
    period = leave_service.period_for(pol, org_today())
    types = db.scalars(
        select(LeaveType).where(
            LeaveType.org_id == user.org_id, LeaveType.is_active.is_(True),
            LeaveType.deleted_at.is_(None),
        ).order_by(LeaveType.sort_order, LeaveType.code)
    ).all()

    out: list[BalanceRow] = []
    for emp in visible_employees(db, user):
        for t in types:
            if t.accrual_rule == AccrualRule.NONE:
                continue
            bal = leave_service.balance(db, emp, t, period)
            out.append(BalanceRow(
                employee_code=emp.emp_code, full_name=emp.full_name, code=t.code,
                period=period, accrued=float(bal.accrued), used=float(bal.used),
                available=bal.available,
            ))
    db.commit()
    return out


@router.post("/leave/accrue")
def accrue(
    year: int = Query(...), month: int = Query(ge=1, le=12),
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Credit a month's accrual. Running it twice is a no-op, by design."""
    result = leave_service.accrue_month(db, org_id=user.org_id, year=year, month=month)
    leave_service.audit(
        db, org_id=user.org_id, actor=user, entity="leave_accrual", entity_id=None,
        action="run", changes={"month": {"old": None, "new": f"{year}-{month:02d}"}},
        note=f"credited {result['credited']}, already done {result['skipped']}",
    )
    db.commit()
    return result


@router.post("/leave/carry-forward")
def carry_forward(
    period: str = Query(..., description="The ENDING period, e.g. '2026'"),
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Move what is left of `period` into the period after it.

    Only types with carries_forward=True move anything, capped at carry_cap -
    CL and SL lapse because they were never given the flag. Run once a year at
    the leave-year boundary; running it twice for the same period is a no-op.
    """
    result = leave_service.run_carry_forward(db, org_id=user.org_id, period=period)
    leave_service.audit(
        db, org_id=user.org_id, actor=user, entity="leave_carry_forward", entity_id=None,
        action="run",
        changes={"period": {"old": None, "new": f"{period} -> {result['to_period']}"}},
        note=f"carried {result['credited']}, already done {result['skipped']}",
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Policy - hr_admin only
# ---------------------------------------------------------------------------

@router.get("/leave/policy", response_model=PolicyOut)
def get_policy(db: Session = Depends(get_db), user: User = hr_only):
    pol = leave_service.policy(db, user.org_id)
    db.commit()
    return PolicyOut(
        year_start_month=pol.year_start_month,
        sandwich_rule=pol.sandwich_rule,
        backdate_days=pol.backdate_days,
    )


@router.put("/leave/policy", response_model=PolicyOut)
def set_policy(body: PolicyIn, db: Session = Depends(get_db), user: User = hr_only):
    pol = leave_service.policy(db, user.org_id)
    changes: dict = {}
    for field in ("year_start_month", "sandwich_rule", "backdate_days"):
        old, new = getattr(pol, field), getattr(body, field)
        if old != new:
            changes[field] = {"old": old, "new": new}
            setattr(pol, field, new)

    if changes:
        leave_service.audit(
            db, org_id=user.org_id, actor=user, entity="leave_policy",
            entity_id=pol.id, action="update", changes=changes,
        )
    db.commit()
    return PolicyOut(
        year_start_month=pol.year_start_month,
        sandwich_rule=pol.sandwich_rule,
        backdate_days=pol.backdate_days,
    )


@router.get("/leave/types", response_model=list[TypeOut])
def list_types(db: Session = Depends(get_db), user: User = hr_only):
    rows = db.scalars(
        select(LeaveType).where(
            LeaveType.org_id == user.org_id, LeaveType.deleted_at.is_(None)
        ).order_by(LeaveType.sort_order, LeaveType.code)
    ).all()
    return [
        TypeOut(
            id=t.id, code=t.code, name=t.name, annual_quota=float(t.annual_quota),
            accrual_rule=t.accrual_rule, carries_forward=t.carries_forward,
            carry_cap=float(t.carry_cap), is_paid=t.is_paid,
            requires_proof=t.requires_proof, is_active=t.is_active,
        )
        for t in rows
    ]


@router.put("/leave/types/{type_id}", response_model=TypeOut)
def update_type(
    type_id: uuid.UUID, body: TypeIn,
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Edit a leave type.

    Note what this does NOT do: it does not touch anyone's balance. Raising the
    Earned Leave quota in August applies from the next accrual run forward -
    days already earned stay earned. Silently recomputing balances from the new
    quota would rewrite what people were told they had, which is the one thing
    a leave system must never do.
    """
    row = db.get(LeaveType, type_id)
    if row is None or row.org_id != user.org_id or row.deleted_at is not None:
        raise HTTPException(404, "No such leave type")

    changes: dict = {}
    for field in ("code", "name", "annual_quota", "accrual_rule", "carries_forward",
                  "carry_cap", "is_paid", "requires_proof", "is_active"):
        old, new = getattr(row, field), getattr(body, field)
        if field in ("annual_quota", "carry_cap"):
            old = float(old)
        if isinstance(old, AccrualRule):
            old = old.value
        comparable_new = new.value if isinstance(new, AccrualRule) else new
        if old != comparable_new:
            changes[field] = {"old": old, "new": comparable_new}
            setattr(row, field, new)

    if changes:
        leave_service.audit(
            db, org_id=user.org_id, actor=user, entity="leave_type",
            entity_id=row.id, action="update", changes=changes,
            note="Applies from the next accrual run; existing balances unchanged",
        )
    db.commit()
    return TypeOut(
        id=row.id, code=row.code, name=row.name, annual_quota=float(row.annual_quota),
        accrual_rule=row.accrual_rule, carries_forward=row.carries_forward,
        carry_cap=float(row.carry_cap), is_paid=row.is_paid,
        requires_proof=row.requires_proof, is_active=row.is_active,
    )


@router.get("/leave/audit", response_model=list[AuditRow])
def audit_trail(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db), user: User = hr_only,
):
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.org_id == user.org_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    return [
        AuditRow(at=r.created_at, actor=r.actor_label, entity=r.entity,
                 action=r.action, changes=r.changes or {}, note=r.note)
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Holidays
# ---------------------------------------------------------------------------

@router.get("/holidays", response_model=list[HolidayOut])
def list_holidays(
    year: int = Query(default=0),
    db: Session = Depends(get_db), user: User = approver,
):
    year = year or datetime.now(timezone.utc).year
    rows = db.scalars(
        select(Holiday).where(
            Holiday.org_id == user.org_id,
            Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31),
            Holiday.deleted_at.is_(None),
        ).order_by(Holiday.day)
    ).all()
    return [
        HolidayOut(id=r.id, day=r.day, name=r.name, is_optional=r.is_optional,
                   is_confirmed=r.is_confirmed, note=r.note)
        for r in rows
    ]


@router.post("/holidays", response_model=HolidayOut)
def add_holiday(body: HolidayIn, db: Session = Depends(get_db), user: User = hr_only):
    """Add a holiday AND fix the days it covers.

    The recompute is not an optimisation. Without it the calendar says holiday
    and the board still says absent, which is indistinguishable from the
    holiday never having been added.
    """
    existing = db.scalar(select(Holiday).where(
        Holiday.org_id == user.org_id, Holiday.day == body.day,
        Holiday.deleted_at.is_(None),
    ))
    if existing is not None:
        raise HTTPException(409, f"{body.day} is already {existing.name}")

    row = Holiday(
        id=uuid.uuid4(), org_id=user.org_id, day=body.day, name=body.name,
        is_optional=body.is_optional, is_confirmed=body.is_confirmed, note=body.note,
    )
    db.add(row)
    db.flush()
    leave_service.audit(
        db, org_id=user.org_id, actor=user, entity="holiday", entity_id=row.id,
        action="add", changes={"day": {"old": None, "new": body.day.isoformat()},
                               "name": {"old": None, "new": body.name}},
    )
    if not row.is_optional:
        leave_service.recompute_org_dates(db, user.org_id, [row.day])
        
    from app.services.notifications import notify_org
    notify_org(
        db, org_id=user.org_id, category="holiday.added",
        title="New Holiday Added",
        body=f"Admin added a new leave on {body.day.strftime('%b %d, %Y')}",
        data={"holiday_id": str(row.id)},
    )
    
    db.commit()
    return HolidayOut(id=row.id, day=row.day, name=row.name,
                      is_optional=row.is_optional, is_confirmed=row.is_confirmed,
                      note=row.note)


@router.delete("/holidays/{holiday_id}")
def remove_holiday(
    holiday_id: uuid.UUID, db: Session = Depends(get_db), user: User = hr_only,
):
    row = db.get(Holiday, holiday_id)
    if row is None or row.org_id != user.org_id or row.deleted_at is not None:
        raise HTTPException(404, "No such holiday")

    day = row.day
    row.deleted_at = datetime.now(timezone.utc)   # soft delete, house rule
    db.flush()
    leave_service.audit(
        db, org_id=user.org_id, actor=user, entity="holiday", entity_id=row.id,
        action="remove", changes={"day": {"old": day.isoformat(), "new": None},
                                  "name": {"old": row.name, "new": None}},
    )
    leave_service.recompute_org_dates(db, user.org_id, [day])
    db.commit()
    return {"removed": True, "day": day.isoformat(), "recomputed": True}
