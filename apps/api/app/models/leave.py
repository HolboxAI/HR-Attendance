"""Leave, holidays, and the policy HR edits.

Two things here are load-bearing and easy to get wrong later:

**`LeaveRequest.days_consumed` is stored, not derived.** It is worked out from
the policy in force on the day the request was decided, and then frozen. If
someone turns the sandwich rule on in August, a leave taken in March must not
quietly start costing an extra two days. Recomputing it on read would do
exactly that.

**Accrual is recorded, not inferred.** `AccrualRun` has a unique key per
employee/type/period/month, so running the monthly job twice is a no-op rather
than a doubling. Deriving "how much should they have by now" from the current
quota would silently rewrite history the moment a quota changes.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID, JSONType
from app.models.enums import AccrualRule, LeaveStatus


class LeavePolicy(Base, TimestampMixin):
    """Org-wide leave settings. One row per organisation.

    Everything on here is HR's to change from the dashboard. Nothing may be
    read from a config file or a constant: the first time a quota changes,
    nobody should need a developer.
    """

    __tablename__ = "leave_policies"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), unique=True, nullable=False
    )

    # 1 = January-December, 4 = April-March (the Indian financial year).
    year_start_month: Mapped[int] = mapped_column(default=1, nullable=False)

    # If someone takes Friday and Monday, does the weekend count as leave too?
    # Common in Indian firms and much resented, so it is off unless asked for.
    sandwich_rule: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # How many days back an employee may apply for. HR can go further.
    backdate_days: Mapped[int] = mapped_column(default=7, nullable=False)


class LeaveType(Base, TimestampMixin):
    __tablename__ = "leave_types"
    __table_args__ = (UniqueConstraint("org_id", "code", name="uq_leave_type_code_per_org"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    code: Mapped[str] = mapped_column(String(16), nullable=False)       # CL, SL, EL, LOP
    name: Mapped[str] = mapped_column(String(80), nullable=False)

    annual_quota: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    accrual_rule: Mapped[AccrualRule] = mapped_column(
        default=AccrualRule.MONTHLY, nullable=False
    )
    carries_forward: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    carry_cap: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)

    # Unpaid types (Loss of Pay) have no balance to run out of, so the
    # over-balance check does not apply to them.
    is_paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    requires_proof: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)


class LeaveBalance(Base, TimestampMixin):
    """What one person has, of one type, in one leave year."""

    __tablename__ = "leave_balances"
    __table_args__ = (
        UniqueConstraint("employee_id", "leave_type_id", "period", name="uq_balance_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("leave_types.id"), index=True, nullable=False
    )
    # The leave-year label: "2026" for Jan-Dec, "2026-27" for Apr-Mar.
    period: Mapped[str] = mapped_column(String(16), index=True, nullable=False)

    opening: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    accrued: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    used: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    encashed: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)

    @property
    def available(self) -> float:
        return float(self.opening) + float(self.accrued) - float(self.used) - float(self.encashed)


class AccrualRun(Base, TimestampMixin):
    """One row per month actually credited. This is what makes accrual idempotent.

    The unique constraint is the guarantee: a second run for the same month
    finds the row and does nothing, so a cron that fires twice, or an HR user
    who clicks the button again, cannot inflate anyone's entitlement.
    """

    __tablename__ = "leave_accrual_runs"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "leave_type_id", "period", "month", name="uq_accrual_once",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("leave_types.id"), nullable=False
    )
    period: Mapped[str] = mapped_column(String(16), nullable=False)
    month: Mapped[int] = mapped_column(nullable=False)          # 1-12, calendar month
    amount: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    # The quota this credit was calculated from, so a later quota change is
    # visible as a difference rather than rewriting what was already given.
    quota_at_run: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)


class CarryForwardRun(Base, TimestampMixin):
    """One row per employee/type/target-period actually carried. Same trick as
    AccrualRun: the unique constraint IS the idempotency guarantee, so running
    the year-end rollover twice for the same period is a no-op rather than a
    second helping of Earned Leave.
    """

    __tablename__ = "leave_carry_forward_runs"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "leave_type_id", "to_period", name="uq_carry_forward_once",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("leave_types.id"), nullable=False
    )
    from_period: Mapped[str] = mapped_column(String(16), nullable=False)
    to_period: Mapped[str] = mapped_column(String(16), nullable=False)
    # What was actually carried, after the cap. Kept even when it is 0 or when
    # the cap clipped it, so "why does Nikunj only have 30, not 34" has an
    # answer that is not "guess".
    amount: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    available_before_cap: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)


class LeaveRequest(Base, TimestampMixin):
    __tablename__ = "leave_requests"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("leave_types.id"), nullable=False
    )

    from_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    half_day_start: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    half_day_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    category: Mapped[str | None] = mapped_column(String(64))
    reason: Mapped[str | None] = mapped_column(Text)

    status: Mapped[LeaveStatus] = mapped_column(
        default=LeaveStatus.PENDING, index=True, nullable=False
    )
    # Frozen at decision time. See the module docstring.
    days_consumed: Mapped[float] = mapped_column(Numeric(6, 2), default=0, nullable=False)
    period: Mapped[str] = mapped_column(String(16), nullable=False)

    approver_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_note: Mapped[str | None] = mapped_column(Text)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    slack_message_ts: Mapped[str | None] = mapped_column(String(32))
    slack_channel_id: Mapped[str | None] = mapped_column(String(32))

    medical_document_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    medical_document_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    medical_document_url: Mapped[str | None] = mapped_column(String(500))
    medical_document_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Holiday(Base, TimestampMixin):
    __tablename__ = "holidays"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    # NULL = every site. Boxcode has one office today, but a Gujarat holiday is
    # not a Karnataka holiday and that difference arrives with the second one.
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("locations.id"), index=True
    )
    day: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    # Optional/restricted holidays are a real Indian construct: a list from
    # which each employee picks a couple. They do NOT close the office, so they
    # must not resolve to "holiday" for everyone.
    is_optional: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Lunar-calendar festivals move year to year and are fixed by state
    # notification. Seeded values are marked unconfirmed so HR is prompted to
    # check them against the official list rather than trusting a guess.
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200))


class AuditLog(Base, TimestampMixin):
    """Who changed what, from what, to what.

    Quotas decide what people are owed. "It says 12 now but I'm sure it was 15"
    has to be answerable, and it can only be answered if the old value was
    written down at the moment it changed.
    """

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("users.id"))
    actor_label: Mapped[str] = mapped_column(String(200), nullable=False)

    entity: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), index=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    # {field: {"old": ..., "new": ...}} - a dict so one edit is one row even
    # when it touches several fields.
    changes: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    note: Mapped[str | None] = mapped_column(String(400))
