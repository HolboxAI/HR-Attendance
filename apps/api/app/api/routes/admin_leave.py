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

from app.api.deps import RANK, require_role
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
    # Cap on leave days in any calendar month. null = no monthly max.
    monthly_leave_max: float | None = None
    # Present when balances are fetched with ?year=&month= (month-edit mode).
    month: int | None = None
    month_credit: float | None = None
    month_credit_cap: float | None = None


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
    # Managers still do not see their own request: they cannot decide it.
    # HR and super admins do, because they are allowed to approve their own.
    is_admin = RANK.get(user.role, -1) >= RANK[UserRole.HR_ADMIN]
    return [
        to_request_out(db, r, scope[r.employee_id])
        for r in rows
        if r.employee_id in scope and (is_admin or r.employee_id != user.employee_id)
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
    return to_request_out(db, row, emp)


@router.get("/leave/balances", response_model=list[BalanceRow])
def balances(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db), user: User = approver,
):
    """Year remaining always. Pass year+month to also include that month's credit."""
    pol = leave_service.policy(db, user.org_id)
    today = org_today()
    period = leave_service.period_for(pol, today)
    month_mode = year is not None and month is not None
    if month_mode:
        period = leave_service.period_for(pol, date(year, month, 1))
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
            max_m = (
                None if emp.monthly_leave_max is None
                else float(emp.monthly_leave_max)
            )
            row = BalanceRow(
                employee_code=emp.emp_code, full_name=emp.full_name, code=t.code,
                period=period, accrued=float(bal.accrued), used=float(bal.used),
                available=bal.available, monthly_leave_max=max_m,
            )
            if month_mode:
                row.month = month
                row.month_credit = leave_service.month_credit(db, emp, t, period, month)
                row.month_credit_cap = leave_service.monthly_credit_cap(t)
            out.append(row)
    db.commit()
    return out


class BalanceEditItem(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    available: float = Field(ge=0, le=365)
    note: str | None = None


class BalanceEditIn(BaseModel):
    items: list[BalanceEditItem] = Field(min_length=1, max_length=20)


class BalanceEditOut(BaseModel):
    employee_code: str
    full_name: str
    code: str
    period: str
    accrued: float
    used: float
    available: float
    changed: bool


class MonthlyMaxIn(BaseModel):
    """null clears the cap (unlimited). 0 blocks leave that month entirely."""
    monthly_leave_max: float | None = Field(default=None, ge=0, le=31)
    note: str | None = None


class MonthlyMaxOut(BaseModel):
    employee_code: str
    full_name: str
    monthly_leave_max: float | None
    changed: bool


def _leave_type_for(db: Session, org_id: uuid.UUID, code: str) -> LeaveType:
    row = db.scalar(select(LeaveType).where(
        LeaveType.org_id == org_id, LeaveType.code == code.upper(),
        LeaveType.is_active.is_(True), LeaveType.deleted_at.is_(None),
    ))
    if row is None:
        raise HTTPException(404, f"No leave type {code}")
    if row.accrual_rule == AccrualRule.NONE:
        raise HTTPException(409, f"{code} has no balance to edit")
    return row


def _apply_items(
    db: Session, *, emp: Employee, items: list[BalanceEditItem], actor: User, period: str,
) -> list[BalanceEditOut]:
    out: list[BalanceEditOut] = []
    for item in items:
        lt = _leave_type_for(db, emp.org_id, item.code)
        try:
            bal, changed = leave_service.set_available(
                db, employee=emp, leave_type=lt, period=period,
                available=item.available, actor=actor, note=item.note,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        out.append(BalanceEditOut(
            employee_code=emp.emp_code, full_name=emp.full_name, code=lt.code,
            period=period, accrued=float(bal.accrued), used=float(bal.used),
            available=bal.available, changed=changed,
        ))
    return out


@router.put("/leave/balances/all", response_model=list[BalanceEditOut])
def set_balances_for_everyone(
    body: BalanceEditIn, db: Session = Depends(get_db), user: User = hr_only,
):
    """Set remaining CL/EL/SL for every active employee HR can see.

    Used days are not rewritten. Each person's remaining figure is moved to
    the number sent; opening absorbs the difference so accrual history stays.
    """
    pol = leave_service.policy(db, user.org_id)
    period = leave_service.period_for(pol, org_today())
    out: list[BalanceEditOut] = []
    for emp in visible_employees(db, user):
        out.extend(_apply_items(db, emp=emp, items=body.items, actor=user, period=period))
    db.commit()
    return out


class MonthCreditIn(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    year: int
    month: int = Field(ge=1, le=12)
    amount: float = Field(ge=0, le=31)
    note: str | None = None


class MonthCreditOut(BaseModel):
    employee_code: str
    full_name: str
    code: str
    year: int
    month: int
    amount: float
    cap: float
    available: float
    changed: bool


@router.put("/leave/balances/month-credit/all", response_model=list[MonthCreditOut])
def set_month_credit_for_everyone(
    body: MonthCreditIn, db: Session = Depends(get_db), user: User = hr_only,
):
    """Set the same month credit for every active employee (still capped per type)."""
    lt = _leave_type_for(db, user.org_id, body.code)
    pol = leave_service.policy(db, user.org_id)
    period = leave_service.period_for(pol, date(body.year, body.month, 1))
    out: list[MonthCreditOut] = []
    for emp in visible_employees(db, user):
        try:
            amount, cap, changed = leave_service.set_month_credit(
                db, employee=emp, leave_type=lt, period=period,
                year=body.year, month=body.month, amount=body.amount,
                actor=user, note=body.note,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        bal = leave_service.balance(db, emp, lt, period)
        out.append(MonthCreditOut(
            employee_code=emp.emp_code, full_name=emp.full_name, code=lt.code,
            year=body.year, month=body.month, amount=amount, cap=cap,
            available=bal.available, changed=changed,
        ))
    db.commit()
    return out


@router.put("/leave/balances/{emp_code}/month-credit", response_model=MonthCreditOut)
def set_month_credit_for_employee(
    emp_code: str, body: MonthCreditIn,
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Set one person's accrual credit for one calendar month (capped at quota/12)."""
    emp = next((e for e in visible_employees(db, user) if e.emp_code == emp_code), None)
    if emp is None:
        raise HTTPException(404, f"No employee {emp_code} in your scope")
    lt = _leave_type_for(db, emp.org_id, body.code)
    pol = leave_service.policy(db, user.org_id)
    period = leave_service.period_for(pol, date(body.year, body.month, 1))
    try:
        amount, cap, changed = leave_service.set_month_credit(
            db, employee=emp, leave_type=lt, period=period,
            year=body.year, month=body.month, amount=body.amount,
            actor=user, note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    bal = leave_service.balance(db, emp, lt, period)
    db.commit()
    return MonthCreditOut(
        employee_code=emp.emp_code, full_name=emp.full_name, code=lt.code,
        year=body.year, month=body.month, amount=amount, cap=cap,
        available=bal.available, changed=changed,
    )


@router.put("/leave/balances/monthly-max/all", response_model=list[MonthlyMaxOut])
def set_monthly_leave_max_for_everyone(
    body: MonthlyMaxIn, db: Session = Depends(get_db), user: User = hr_only,
):
    """Set the same monthly leave max for every active employee in scope."""
    out: list[MonthlyMaxOut] = []
    for emp in visible_employees(db, user):
        try:
            value, changed = leave_service.set_monthly_leave_max(
                db, employee=emp, monthly_leave_max=body.monthly_leave_max,
                actor=user, note=body.note,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        out.append(MonthlyMaxOut(
            employee_code=emp.emp_code, full_name=emp.full_name,
            monthly_leave_max=value, changed=changed,
        ))
    db.commit()
    return out


@router.put("/leave/balances/{emp_code}/monthly-max", response_model=MonthlyMaxOut)
def set_monthly_leave_max_for_employee(
    emp_code: str, body: MonthlyMaxIn,
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Set this person's max leave days in any calendar month (Team balances)."""
    emp = next((e for e in visible_employees(db, user) if e.emp_code == emp_code), None)
    if emp is None:
        raise HTTPException(404, f"No employee {emp_code} in your scope")
    try:
        value, changed = leave_service.set_monthly_leave_max(
            db, employee=emp, monthly_leave_max=body.monthly_leave_max,
            actor=user, note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    db.commit()
    return MonthlyMaxOut(
        employee_code=emp.emp_code, full_name=emp.full_name,
        monthly_leave_max=value, changed=changed,
    )


@router.put("/leave/balances/{emp_code}", response_model=list[BalanceEditOut])
def set_balances_for_employee(
    emp_code: str, body: BalanceEditIn,
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Set remaining days of one or more leave types for one person."""
    emp = next((e for e in visible_employees(db, user) if e.emp_code == emp_code), None)
    if emp is None:
        raise HTTPException(404, f"No employee {emp_code} in your scope")
    pol = leave_service.policy(db, user.org_id)
    period = leave_service.period_for(pol, org_today())
    out = _apply_items(db, emp=emp, items=body.items, actor=user, period=period)
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


@router.put("/holidays/{holiday_id}", response_model=HolidayOut)
def update_holiday(
    holiday_id: uuid.UUID, body: HolidayIn,
    db: Session = Depends(get_db), user: User = hr_only,
):
    """Edit a holiday (date, name, office-closed vs optional, confirmed).

    Recomputes any date that changed or flipped between leave-day and open.
    """
    row = db.get(Holiday, holiday_id)
    if row is None or row.org_id != user.org_id or row.deleted_at is not None:
        raise HTTPException(404, "No such holiday")

    clash = db.scalar(select(Holiday).where(
        Holiday.org_id == user.org_id, Holiday.day == body.day,
        Holiday.deleted_at.is_(None), Holiday.id != row.id,
    ))
    if clash is not None:
        raise HTTPException(409, f"{body.day} is already {clash.name}")

    old_day, old_optional = row.day, row.is_optional
    changes = {}
    if row.day != body.day:
        changes["day"] = {"old": old_day.isoformat(), "new": body.day.isoformat()}
        row.day = body.day
    if row.name != body.name:
        changes["name"] = {"old": row.name, "new": body.name}
        row.name = body.name
    if row.is_optional != body.is_optional:
        changes["is_optional"] = {"old": row.is_optional, "new": body.is_optional}
        row.is_optional = body.is_optional
    if row.is_confirmed != body.is_confirmed:
        changes["is_confirmed"] = {"old": row.is_confirmed, "new": body.is_confirmed}
        row.is_confirmed = body.is_confirmed
    if (row.note or None) != (body.note or None):
        changes["note"] = {"old": row.note, "new": body.note}
        row.note = body.note

    if changes:
        db.flush()
        leave_service.audit(
            db, org_id=user.org_id, actor=user, entity="holiday", entity_id=row.id,
            action="edit", changes=changes,
        )
        days = {old_day, row.day}
        # Recompute when the day moved or office-closed status changed.
        if "day" in changes or "is_optional" in changes:
            leave_service.recompute_org_dates(db, user.org_id, sorted(days))
        db.commit()

    return HolidayOut(
        id=row.id, day=row.day, name=row.name,
        is_optional=row.is_optional, is_confirmed=row.is_confirmed, note=row.note,
    )


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


class PlannedNoticeRow(BaseModel):
    name: str
    code: str
    dates: list[str]


@router.get("/leave/planned-absences", response_model=list[PlannedNoticeRow])
def planned_absence_roster(
    db: Session = Depends(get_db),
    user: User = hr_only,
) -> list[PlannedNoticeRow]:
    """People with leave or an advance notice from today forward."""
    from app.services.planned_absence import notice_roster

    return [
        PlannedNoticeRow(**row)
        for row in notice_roster(db, user.org_id, org_today())
    ]
