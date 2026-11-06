"""Leave: policy, balances, requests, and the bit that matters - the recompute.

The whole point of this module is the last part. A leave module that stores
requests but leaves the board still saying "absent" has delivered nothing, so
`decide()` and `cancel()` recompute every affected day before they return.

Policy is read from the database at call time, never from a constant. HR
changes a quota in the dashboard and the next request uses it, with no restart
and no developer.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.clock import org_today
from app.models.employee import Employee, User
from app.api.deps import RANK
from app.models.enums import AccrualRule, LeaveStatus, UserRole
from app.models.leave import (
    AccrualRun, AuditLog, CarryForwardRun, Holiday, LeaveBalance, LeavePolicy,
    LeaveRequest, LeaveType,
)
from app.models.org import Organization
from app.services import notifications

HALF = 0.5


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

def policy(db: Session, org_id: uuid.UUID) -> LeavePolicy:
    """The org's leave settings, created with defaults on first read.

    Defaults are the brief's starting values, not decisions - Krish confirms
    the real policy, and HR changes them in the UI afterwards.
    """
    row = db.scalar(select(LeavePolicy).where(LeavePolicy.org_id == org_id))
    if row is None:
        row = LeavePolicy(id=uuid.uuid4(), org_id=org_id)
        db.add(row)
        db.flush()
    return row


def period_for(pol: LeavePolicy, day: date) -> str:
    """The leave-year label a date falls in.

    January-December gives "2026". April-March gives "2026-27", because
    "2026" would be ambiguous across the year boundary and payroll people
    read these labels.
    """
    if pol.year_start_month == 1:
        return str(day.year)
    start_year = day.year if day.month >= pol.year_start_month else day.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def period_bounds(pol: LeavePolicy, period: str) -> tuple[date, date]:
    if pol.year_start_month == 1:
        y = int(period)
        return date(y, 1, 1), date(y, 12, 31)
    start_year = int(period.split("-")[0])
    start = date(start_year, pol.year_start_month, 1)
    end = date(start_year + 1, pol.year_start_month, 1) - timedelta(days=1)
    return start, end


# ---------------------------------------------------------------------------
# Holidays
# ---------------------------------------------------------------------------

def holiday_map(
    db: Session,
    org_id: uuid.UUID,
    location_id: uuid.UUID | None,
    start: date,
    end: date,
) -> dict[date, Holiday]:
    """Closed-office holidays in a range, keyed by date.

    Optional (restricted) holidays are excluded on purpose: they are a list
    each employee picks a couple from, the office stays open, and treating one
    as a company holiday would mark everybody present-by-default.
    """
    rows = db.scalars(
        select(Holiday).where(
            Holiday.org_id == org_id,
            Holiday.day >= start,
            Holiday.day <= end,
            Holiday.is_optional.is_(False),
            Holiday.deleted_at.is_(None),
            or_(Holiday.location_id.is_(None), Holiday.location_id == location_id),
        )
    ).all()
    return {r.day: r for r in rows}


def is_holiday(db: Session, employee: Employee, day: date) -> bool:
    return day in holiday_map(db, employee.org_id, employee.location_id, day, day)


# ---------------------------------------------------------------------------
# Counting working days
# ---------------------------------------------------------------------------

def working_days(
    *,
    start: date,
    end: date,
    working_weekdays: tuple[int, ...] | list[int],
    holidays: dict[date, Holiday],
    sandwich: bool,
    half_day_start: bool = False,
    half_day_end: bool = False,
) -> float:
    """How much balance a date range actually consumes.

    Weekends and holidays inside the range are free unless the sandwich rule is
    on, in which case everything between the first and last working day counts.
    Leading and trailing non-working days never count either way - applying for
    "Saturday to Monday" should not bill you for Saturday.
    """
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    countable = [
        d for d in days
        if d.weekday() in working_weekdays and d not in holidays
    ]
    if not countable:
        return 0.0

    if sandwich:
        span = (countable[-1] - countable[0]).days + 1
        total = float(span)
    else:
        total = float(len(countable))

    # A half day only makes sense on a day that counts at all.
    if half_day_start and countable[0] == start:
        total -= HALF
    if half_day_end and countable[-1] == end and end != start:
        total -= HALF
    # Single-day request flagged as a half day at both ends is still one half.
    if half_day_start and half_day_end and start == end:
        total = max(total, 0.0)
    return max(total, 0.0)


def leave_fraction_on(db: Session, employee: Employee, day: date) -> float:
    """How much of this date is covered by APPROVED leave: 0, 0.5 or 1.

    Only approved requests count. A pending one must never make the board say
    "on leave" - that would let anyone mark themselves off simply by asking.
    """
    rows = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.from_date <= day,
            LeaveRequest.to_date >= day,
            LeaveRequest.deleted_at.is_(None),
        )
    ).all()
    if not rows:
        return 0.0

    fraction = 0.0
    for r in rows:
        this = 1.0
        if r.half_day_start and day == r.from_date:
            this = HALF
        if r.half_day_end and day == r.to_date:
            this = HALF
        fraction = max(fraction, this)
    return fraction


# ---------------------------------------------------------------------------
# Balances
# ---------------------------------------------------------------------------

def balance(
    db: Session, employee: Employee, leave_type: LeaveType, period: str
) -> LeaveBalance:
    row = db.scalar(
        select(LeaveBalance).where(
            LeaveBalance.employee_id == employee.id,
            LeaveBalance.leave_type_id == leave_type.id,
            LeaveBalance.period == period,
        )
    )
    if row is None:
        row = LeaveBalance(
            id=uuid.uuid4(), employee_id=employee.id,
            leave_type_id=leave_type.id, period=period,
        )
        db.add(row)
        db.flush()
    return row


def set_available(
    db: Session,
    *,
    employee: Employee,
    leave_type: LeaveType,
    period: str,
    available: float,
    actor: User,
    note: str | None = None,
) -> tuple[LeaveBalance, bool]:
    """Set remaining days for one person/type without rewriting used.

    Available is opening + accrued - used - encashed. HR edits the remaining
    figure they see on Team balances; the delta is stored on opening so the
    used and accrued history stays intact. A no-op (same number) writes
    nothing, so clicking save twice is not two audit rows.
    """
    if available < 0:
        raise ValueError("Remaining days cannot be negative")
    bal = balance(db, employee, leave_type, period)
    old = round(float(bal.available), 2)
    new = round(float(available), 2)
    if old == new:
        return bal, False
    bal.opening = float(bal.opening) + (new - old)
    audit(
        db, org_id=employee.org_id, actor=actor, entity="leave_balance",
        entity_id=bal.id, action="update",
        changes={
            "code": {"old": leave_type.code, "new": leave_type.code},
            "employee": {"old": employee.emp_code, "new": employee.emp_code},
            "available": {"old": old, "new": new},
        },
        note=note or f"{employee.emp_code} {leave_type.code} remaining {old} → {new}",
    )
    return bal, True


def monthly_credit_cap(leave_type: LeaveType) -> float:
    """Max days HR may credit for one calendar month: annual quota ÷ 12.

    Same cap whether the type accrues monthly or annually — Team balances
    month mode edits that month's credit, not a lump-sum year dump.
    """
    if leave_type.accrual_rule == AccrualRule.NONE:
        return 0.0
    return round(float(leave_type.annual_quota) / 12.0, 2)


def pending_days_held(
    db: Session, employee: Employee, leave_type: LeaveType, period: str,
    exclude: uuid.UUID | None = None,
) -> float:
    """Days already spoken for by pending requests (not yet in `used`)."""
    stmt = select(LeaveRequest).where(
        LeaveRequest.employee_id == employee.id,
        LeaveRequest.leave_type_id == leave_type.id,
        LeaveRequest.period == period,
        LeaveRequest.status == LeaveStatus.PENDING,
        LeaveRequest.deleted_at.is_(None),
    )
    if exclude is not None:
        stmt = stmt.where(LeaveRequest.id != exclude)
    total = 0.0
    for row in db.scalars(stmt).all():
        total += float(row.days_consumed)
    return round(total, 2)


def effective_available(
    db: Session, employee: Employee, leave_type: LeaveType, period: str,
    exclude: uuid.UUID | None = None,
) -> float:
    """What the person can still apply for: balance minus pending holds."""
    bal = balance(db, employee, leave_type, period)
    return round(float(bal.available) - pending_days_held(
        db, employee, leave_type, period, exclude=exclude,
    ), 2)


def month_credit(
    db: Session, employee: Employee, leave_type: LeaveType, period: str, month: int,
) -> float:
    """Amount already credited for this calendar month (0 if never accrued)."""
    row = db.scalar(
        select(AccrualRun).where(
            AccrualRun.employee_id == employee.id,
            AccrualRun.leave_type_id == leave_type.id,
            AccrualRun.period == period,
            AccrualRun.month == month,
        )
    )
    return float(row.amount) if row else 0.0


def set_month_credit(
    db: Session,
    *,
    employee: Employee,
    leave_type: LeaveType,
    period: str,
    year: int,
    month: int,
    amount: float,
    actor: User,
    note: str | None = None,
) -> tuple[float, float, bool]:
    """Set this month's accrual credit (0 … monthly cap). Adjusts accrued.

    Returns (new_amount, cap, changed). Cap is annual_quota/12 for monthly types
    — HR cannot give more than one month's fixed rate here.
    """
    if month < 1 or month > 12:
        raise ValueError("Month must be 1–12")
    cap = monthly_credit_cap(leave_type)
    amount = round(float(amount), 2)
    if amount < 0 or amount > cap + 1e-9:
        raise ValueError(
            f"Month credit for {leave_type.code} must be between 0 and {cap:g} "
            f"(fixed monthly rate from annual quota {float(leave_type.annual_quota):g})"
        )

    row = db.scalar(
        select(AccrualRun).where(
            AccrualRun.employee_id == employee.id,
            AccrualRun.leave_type_id == leave_type.id,
            AccrualRun.period == period,
            AccrualRun.month == month,
        )
    )
    bal = balance(db, employee, leave_type, period)
    old = float(row.amount) if row else 0.0
    if round(old, 2) == amount:
        return amount, cap, False

    delta = amount - old
    bal.accrued = float(bal.accrued) + delta
    if row is None:
        row = AccrualRun(
            id=uuid.uuid4(),
            employee_id=employee.id,
            leave_type_id=leave_type.id,
            period=period,
            month=month,
            amount=amount,
            quota_at_run=float(leave_type.annual_quota),
        )
        db.add(row)
    else:
        row.amount = amount
        row.quota_at_run = float(leave_type.annual_quota)

    audit(
        db, org_id=employee.org_id, actor=actor, entity="leave_accrual",
        entity_id=row.id, action="set_month_credit",
        changes={
            "employee": {"old": employee.emp_code, "new": employee.emp_code},
            "code": {"old": leave_type.code, "new": leave_type.code},
            "month": {"old": f"{year}-{month:02d}", "new": f"{year}-{month:02d}"},
            "amount": {"old": old, "new": amount},
        },
        note=note or f"{employee.emp_code} {leave_type.code} {year}-{month:02d} credit {old} → {amount}",
    )
    return amount, cap, True


def next_period(pol: LeavePolicy, period: str) -> str:
    """The period label that comes immediately after this one."""
    _, end = period_bounds(pol, period)
    return period_for(pol, end + timedelta(days=1))


def run_carry_forward(db: Session, *, org_id: uuid.UUID, period: str) -> dict:
    """Move what is left of `period` into the period that follows it.

    Only for leave types with carries_forward=True, and only up to carry_cap -
    anything above the cap lapses, same as CL and SL lapse entirely, because
    neither has this flag set. Safe to run twice: CarryForwardRun's unique key
    is what makes a second run a no-op instead of a second helping of Earned
    Leave.

    This does not touch the OLD period's balance. Leave already taken stays
    taken, leave already accrued stays accrued - only the leftover is copied
    forward as the new period's opening figure. History is never rewritten,
    only read from.
    """
    pol = policy(db, org_id)
    to_period = next_period(pol, period)

    types = db.scalars(
        select(LeaveType).where(
            LeaveType.org_id == org_id, LeaveType.is_active.is_(True),
            LeaveType.carries_forward.is_(True), LeaveType.deleted_at.is_(None),
        )
    ).all()
    employees = db.scalars(
        select(Employee).where(Employee.org_id == org_id, Employee.is_active.is_(True))
    ).all()

    credited = skipped = 0
    for emp in employees:
        for lt in types:
            existing = db.scalar(
                select(CarryForwardRun).where(
                    CarryForwardRun.employee_id == emp.id,
                    CarryForwardRun.leave_type_id == lt.id,
                    CarryForwardRun.to_period == to_period,
                )
            )
            if existing is not None:
                skipped += 1
                continue

            old_balance = balance(db, emp, lt, period)
            available = max(0.0, old_balance.available)
            carried = min(available, float(lt.carry_cap))

            new_balance = balance(db, emp, lt, to_period)
            new_balance.opening = float(new_balance.opening) + carried

            db.add(CarryForwardRun(
                id=uuid.uuid4(), employee_id=emp.id, leave_type_id=lt.id,
                from_period=period, to_period=to_period, amount=carried,
                available_before_cap=available,
            ))
            credited += 1

    db.flush()
    return {
        "from_period": period, "to_period": to_period,
        "credited": credited, "skipped": skipped,
    }


def accrue_month(
    db: Session, *, org_id: uuid.UUID, year: int, month: int
) -> dict:
    """Credit one month of accrual to everyone. Safe to run twice.

    Idempotency is enforced by a unique row per employee/type/period/month
    rather than by "have we run today" bookkeeping, so a cron that fires twice,
    a retried job, and an HR user clicking the button again are all no-ops.
    """
    pol = policy(db, org_id)
    types = db.scalars(
        select(LeaveType).where(
            LeaveType.org_id == org_id,
            LeaveType.is_active.is_(True),
            LeaveType.accrual_rule != AccrualRule.NONE,
            LeaveType.deleted_at.is_(None),
        )
    ).all()
    employees = db.scalars(
        select(Employee).where(
            Employee.org_id == org_id, Employee.is_active.is_(True)
        )
    ).all()

    period = period_for(pol, date(year, month, 1))
    credited = skipped = 0

    for emp in employees:
        for lt in types:
            existing = db.scalar(
                select(AccrualRun).where(
                    AccrualRun.employee_id == emp.id,
                    AccrualRun.leave_type_id == lt.id,
                    AccrualRun.period == period,
                    AccrualRun.month == month,
                )
            )
            if existing is not None:
                skipped += 1
                continue

            quota = float(lt.annual_quota)
            if lt.accrual_rule == AccrualRule.MONTHLY:
                amount = round(quota / 12, 2)
            else:                                   # ANNUAL: only in month one
                start_month = pol.year_start_month
                amount = quota if month == start_month else 0.0

            bal = balance(db, emp, lt, period)
            bal.accrued = float(bal.accrued) + amount
            db.add(AccrualRun(
                id=uuid.uuid4(), employee_id=emp.id, leave_type_id=lt.id,
                period=period, month=month, amount=amount, quota_at_run=quota,
            ))
            credited += 1

    db.flush()
    return {"period": period, "month": month, "credited": credited, "skipped": skipped}


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

def audit(
    db: Session, *, org_id: uuid.UUID, actor: User | None, entity: str,
    entity_id: uuid.UUID | None, action: str, changes: dict | None = None,
    note: str | None = None,
) -> AuditLog:
    row = AuditLog(
        id=uuid.uuid4(), org_id=org_id,
        actor_user_id=actor.id if actor else None,
        actor_label=actor.email if actor else "system",
        entity=entity, entity_id=entity_id, action=action,
        changes=changes or {}, note=note,
    )
    db.add(row)
    db.flush()
    return row


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LeaveOutcome:
    ok: bool
    request: LeaveRequest | None = None
    reason: str | None = None
    available: float | None = None
    requested: float | None = None


def _shift_weekdays(db: Session, employee: Employee, on: date) -> tuple[int, ...]:
    # Imported here rather than at module scope: attendance imports this module
    # for the recompute lookups, so a top-level import would be circular.
    from app.services.attendance import policy_for

    shift, _ = policy_for(db, employee, on)
    return tuple(shift.working_days)


def days_for(
    db: Session, employee: Employee, *, start: date, end: date,
    half_day_start: bool, half_day_end: bool,
) -> float:
    pol = policy(db, employee.org_id)
    return working_days(
        start=start, end=end,
        working_weekdays=_shift_weekdays(db, employee, start),
        holidays=holiday_map(db, employee.org_id, employee.location_id, start, end),
        sandwich=pol.sandwich_rule,
        half_day_start=half_day_start, half_day_end=half_day_end,
    )


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year, 12, 31)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end


def _months_touched(start: date, end: date) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        out.append((y, m))
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return out


def days_in_calendar_month(
    db: Session, employee: Employee, *, year: int, month: int,
    start: date, end: date, half_day_start: bool, half_day_end: bool,
) -> float:
    """Working-day leave count that falls inside one calendar month."""
    month_start, month_end = _month_bounds(year, month)
    clipped_start = max(start, month_start)
    clipped_end = min(end, month_end)
    if clipped_end < clipped_start:
        return 0.0
    return days_for(
        db, employee,
        start=clipped_start, end=clipped_end,
        half_day_start=bool(half_day_start and clipped_start == start),
        half_day_end=bool(half_day_end and clipped_end == end),
    )


def leave_days_already_in_month(
    db: Session, employee: Employee, *, year: int, month: int,
    exclude: uuid.UUID | None = None,
) -> float:
    """Pending + approved (+ partial) leave days already booked in that month."""
    month_start, month_end = _month_bounds(year, month)
    rows = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status.in_([
                LeaveStatus.PENDING, LeaveStatus.APPROVED, LeaveStatus.PARTIALLY_APPROVED,
            ]),
            LeaveRequest.from_date <= month_end,
            LeaveRequest.to_date >= month_start,
            LeaveRequest.deleted_at.is_(None),
        )
    ).all()
    total = 0.0
    for r in rows:
        if exclude is not None and r.id == exclude:
            continue
        total += days_in_calendar_month(
            db, employee, year=year, month=month,
            start=r.from_date, end=r.to_date,
            half_day_start=bool(r.half_day_start), half_day_end=bool(r.half_day_end),
        )
    return total


def check_monthly_leave_max(
    db: Session, employee: Employee, *, start: date, end: date,
    half_day_start: bool = False, half_day_end: bool = False,
    exclude: uuid.UUID | None = None,
) -> LeaveOutcome | None:
    """Refuse if any calendar month would go over this person's monthly max.

    NULL monthly_leave_max means no cap. Returns None when under the limit.
    """
    cap = employee.monthly_leave_max
    if cap is None:
        return None
    limit = float(cap)
    if limit < 0:
        return LeaveOutcome(False, reason="Monthly leave max is misconfigured")

    for year, month in _months_touched(start, end):
        already = leave_days_already_in_month(
            db, employee, year=year, month=month, exclude=exclude,
        )
        adding = days_in_calendar_month(
            db, employee, year=year, month=month,
            start=start, end=end,
            half_day_start=half_day_start, half_day_end=half_day_end,
        )
        total = round(already + adding, 2)
        if total > limit + 1e-9:
            label = date(year, month, 1).strftime("%b %Y")
            return LeaveOutcome(
                False,
                reason=(
                    f"Monthly leave max is {limit:g} day(s). "
                    f"{label} would be {total:g} "
                    f"({already:g} already booked + {adding:g} in this request)."
                ),
                available=max(0.0, round(limit - already, 2)),
                requested=adding,
            )
    return None


def set_monthly_leave_max(
    db: Session, *, employee: Employee, monthly_leave_max: float | None,
    actor: User, note: str | None = None,
) -> tuple[float | None, bool]:
    """Set or clear this person's monthly leave cap. Returns (value, changed)."""
    if monthly_leave_max is not None:
        if monthly_leave_max < 0 or monthly_leave_max > 31:
            raise ValueError("Monthly leave max must be between 0 and 31 days")
        monthly_leave_max = round(float(monthly_leave_max), 2)

    old = None if employee.monthly_leave_max is None else float(employee.monthly_leave_max)
    new = monthly_leave_max
    changed = old != new
    if changed:
        employee.monthly_leave_max = new
        audit(
            db, org_id=employee.org_id, actor=actor, entity="employee",
            entity_id=employee.id, action="set_monthly_leave_max",
            changes={"monthly_leave_max": {"old": old, "new": new}},
            note=note or f"Monthly leave max for {employee.emp_code}",
        )
    return new, changed


def overlapping(db: Session, employee: Employee, start: date, end: date,
                exclude: uuid.UUID | None = None) -> LeaveRequest | None:
    """Any live request touching this range.

    Pending counts as live. Two overlapping requests must not both exist even
    briefly, or whichever gets approved second silently double-books the day.
    """
    stmt = select(LeaveRequest).where(
        LeaveRequest.employee_id == employee.id,
        LeaveRequest.status.in_([LeaveStatus.PENDING, LeaveStatus.APPROVED, LeaveStatus.PARTIALLY_APPROVED]),
        LeaveRequest.from_date <= end,
        LeaveRequest.to_date >= start,
        LeaveRequest.deleted_at.is_(None),
    )
    if exclude is not None:
        stmt = stmt.where(LeaveRequest.id != exclude)
    return db.scalar(stmt)


def submit(
    db: Session, *, employee: Employee, leave_type: LeaveType,
    start: date, end: date, category: str | None = None, reason: str | None = None,
    half_day_start: bool = False, half_day_end: bool = False,
    enforce_backdate: bool = True, today: date | None = None,
) -> LeaveOutcome:
    """Apply for leave. Every refusal explains itself with numbers."""
    today = today or org_today()
    pol = policy(db, employee.org_id)

    if end < start:
        return LeaveOutcome(False, reason="End date is before the start date")

    if enforce_backdate and start < today - timedelta(days=pol.backdate_days):
        return LeaveOutcome(
            False,
            reason=f"You can only apply up to {pol.backdate_days} days back. "
                   f"Ask HR to record anything older.",
        )

    clash = overlapping(db, employee, start, end)
    if clash is not None:
        return LeaveOutcome(
            False,
            reason=f"You already have a {clash.status.value} request covering "
                   f"{clash.from_date} to {clash.to_date}",
        )

    days = days_for(db, employee, start=start, end=end,
                    half_day_start=half_day_start, half_day_end=half_day_end)
    if days <= 0:
        return LeaveOutcome(
            False, reason="That range has no working days in it - nothing to apply for",
        )

    capped = check_monthly_leave_max(
        db, employee, start=start, end=end,
        half_day_start=half_day_start, half_day_end=half_day_end,
    )
    if capped is not None:
        return capped

    period = period_for(pol, start)

    # Unpaid types have no balance to run out of, which is the point of them.
    # Pending requests hold days too — otherwise two pending apps can overbook.
    if leave_type.is_paid:
        left = effective_available(db, employee, leave_type, period)
        if days > left + 1e-9:
            return LeaveOutcome(
                False,
                reason=f"Not enough available balance for {leave_type.code}: you have "
                       f"{left:g} day(s) left and asked for {days:g}",
                available=left, requested=days,
            )

    row = LeaveRequest(
        id=uuid.uuid4(), org_id=employee.org_id, employee_id=employee.id,
        leave_type_id=leave_type.id, from_date=start, to_date=end,
        half_day_start=half_day_start, half_day_end=half_day_end,
        category=category, reason=reason, status=LeaveStatus.PENDING,
        days_consumed=days, period=period,
    )
    db.add(row)
    db.flush()
    return LeaveOutcome(True, request=row, requested=days)


def _recompute_range(db: Session, employee: Employee, start: date, end: date) -> int:
    """Rebuild every attendance day the request touches.

    This is the milestone. Without it, approving leave changes a row in
    leave_requests and the board carries on saying "absent" until something
    else happens to touch that date.
    """
    from app.services.attendance import recompute_day

    touched = 0
    day = start
    while day <= end:
        recompute_day(db, employee, day)
        touched += 1
        day += timedelta(days=1)
    return touched


def decide(
    db: Session, *, request: LeaveRequest, approver: User,
    approve: bool, partial_approve: bool = False, medical_document_deadline: datetime | None = None,
    note: str | None = None,
    allow_self_approval: bool = False,
) -> LeaveOutcome:
    """Approve or reject, then immediately fix the days it covers."""
    if request.status not in (LeaveStatus.PENDING, LeaveStatus.PARTIALLY_APPROVED):
        return LeaveOutcome(False, reason=f"That request is already {request.status.value}")

    # Employees and managers still cannot sign off their own leave. HR and
    # super admins can, for the same reason they can decide their own
    # correction: nobody else is above them to do it.
    is_admin = RANK.get(approver.role, -1) >= RANK[UserRole.HR_ADMIN]
    if (
        not allow_self_approval
        and not is_admin
        and approver.employee_id is not None
        and approver.employee_id == request.employee_id
    ):
        return LeaveOutcome(False, reason="You cannot decide your own leave request")

    employee = db.get(Employee, request.employee_id)
    leave_type = db.get(LeaveType, request.leave_type_id)
    was = request.status

    if partial_approve:
        request.status = LeaveStatus.PARTIALLY_APPROVED
        request.medical_document_required = True
        request.medical_document_deadline = medical_document_deadline or (datetime.now(timezone.utc) + timedelta(days=3))
    elif approve:
        capped = check_monthly_leave_max(
            db, employee,
            start=request.from_date, end=request.to_date,
            half_day_start=bool(request.half_day_start),
            half_day_end=bool(request.half_day_end),
            exclude=request.id,
        )
        if capped is not None:
            return capped
        if leave_type.is_paid:
            bal = balance(db, employee, leave_type, request.period)
            left = effective_available(
                db, employee, leave_type, request.period, exclude=request.id,
            )
            if float(request.days_consumed) > left + 1e-9:
                return LeaveOutcome(
                    False,
                    reason=f"{employee.full_name} no longer has the balance for this "
                           f"({left:g} left, {float(request.days_consumed):g} needed)",
                    available=left, requested=float(request.days_consumed),
                )
            bal.used = float(bal.used) + float(request.days_consumed)
        request.status = LeaveStatus.APPROVED
    else:
        request.status = LeaveStatus.REJECTED

    request.approver_id = approver.id
    request.decided_at = datetime.now(timezone.utc)
    request.decided_note = note
    db.flush()

    audit(db, org_id=request.org_id, actor=approver, entity="leave_request",
          entity_id=request.id, action="partial_approve" if partial_approve else ("approve" if approve else "reject"),
          changes={"status": {"old": was.value, "new": request.status.value}},
          note=note)

    if approve:
        _recompute_range(db, employee, request.from_date, request.to_date)

    # An employee with a login receives a notification that their request was decided.
    owner = db.scalar(select(User).where(User.employee_id == employee.id))
    lt_obj = db.get(LeaveType, request.leave_type_id)
    lt_name = lt_obj.name if lt_obj else "Leave"
    if owner is not None:
        title = "Leave partially approved" if partial_approve else ("Leave approved" if approve else "Leave rejected")
        notifications.notify(
            db, org_id=request.org_id, user=owner,
            category=f"leave.{request.status.value}",
            title=title,
            body=note or (f"{lt_name}, {request.from_date} to {request.to_date}"),
            data={"leave_request_id": str(request.id)},
        )

    # Sync decision back to Slack (admin ephemerals — never a public channel post)
    if request.slack_channel_id or request.slack_message_ts:
        from app.services.slack import sync_leave_decision_to_slack
        from threading import Thread
        actor_name = approver.email.split("@")[0] if approver and approver.email else "Admin"
        if approver and approver.employee_id:
            emp_rec = db.get(Employee, approver.employee_id)
            if emp_rec and emp_rec.full_name:
                actor_name = emp_rec.full_name
        
        source = "Slack" if (note and "via Slack" in note) else ("Email" if (note and "via Email" in note) else "Portal")
        if source != "Slack":  # Slack interactions update the clicker's ephemeral card
            Thread(
                target=sync_leave_decision_to_slack,
                args=(request.slack_channel_id, request.slack_message_ts, employee.full_name, lt_name, request.from_date, request.to_date, float(request.days_consumed), request.reason or "No reason provided", approve, actor_name, source, partial_approve, note),
                daemon=True,
            ).start()

    return LeaveOutcome(True, request=request)


def cancel(
    db: Session, *, request: LeaveRequest, actor: User, note: str | None = None,
) -> LeaveOutcome:
    """Withdraw a request. A status change, never a delete.

    Balance is returned and the days are recomputed, so an approved-then-
    cancelled day goes back to whatever the punches actually say.
    """
    if request.status in (LeaveStatus.CANCELLED, LeaveStatus.REJECTED):
        return LeaveOutcome(False, reason=f"That request is already {request.status.value}")

    employee = db.get(Employee, request.employee_id)
    leave_type = db.get(LeaveType, request.leave_type_id)
    was = request.status

    if was == LeaveStatus.APPROVED and leave_type.is_paid:
        bal = balance(db, employee, leave_type, request.period)
        bal.used = max(0.0, float(bal.used) - float(request.days_consumed))

    request.status = LeaveStatus.CANCELLED
    request.cancelled_at = datetime.now(timezone.utc)
    if note:
        request.decided_note = note
    db.flush()

    audit(db, org_id=request.org_id, actor=actor, entity="leave_request",
          entity_id=request.id, action="cancel",
          changes={"status": {"old": was.value, "new": "cancelled"}}, note=note)

    if was == LeaveStatus.APPROVED:
        _recompute_range(db, employee, request.from_date, request.to_date)

    if request.slack_channel_id or request.slack_message_ts:
        from app.services.slack import sync_leave_decision_to_slack
        from threading import Thread
        lt_obj = db.get(LeaveType, request.leave_type_id)
        lt_name = lt_obj.name if lt_obj else "Leave"
        Thread(
            target=sync_leave_decision_to_slack,
            args=(
                request.slack_channel_id,
                request.slack_message_ts,
                employee.full_name,
                lt_name,
                request.from_date,
                request.to_date,
                float(request.days_consumed),
                request.reason or "No reason provided",
                False,
                employee.full_name,
                "Portal",
                False,
                "Cancelled by employee",
            ),
            daemon=True,
        ).start()

    return LeaveOutcome(True, request=request)


def recompute_org_dates(db: Session, org_id: uuid.UUID, days: list[date]) -> int:
    """Rebuild given dates for everyone - used when the holiday calendar changes.

    Adding a holiday that nobody recomputes leaves the board showing the old
    answer, which is indistinguishable from the holiday not having been added.
    """
    from app.services.attendance import recompute_day

    employees = db.scalars(
        select(Employee).where(Employee.org_id == org_id, Employee.is_active.is_(True))
    ).all()
    touched = 0
    for emp in employees:
        for day in days:
            recompute_day(db, emp, day)
            touched += 1
    return touched
