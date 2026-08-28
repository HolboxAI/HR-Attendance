"""One row per scheduled job that actually fired.

The scheduler ticks every minute and asks "is there anything due?". The answer
must not depend on the previous tick's memory - the process restarts, laptops
sleep, and uvicorn --reload replaces the loop mid-day. So each job's "have I
already done this" is a ROW with a unique key, the same trick AccrualRun and
CarryForwardRun already use: a duplicate firing hits the constraint and
becomes a no-op instead of a second notification or a second credit.
"""

import uuid

from sqlalchemy import String, UniqueConstraint

from app.db.base import Base, TimestampMixin
from app.db.types import GUID, JSONType
from sqlalchemy.orm import Mapped, mapped_column


class ScheduledJobRun(Base, TimestampMixin):
    __tablename__ = "scheduled_job_runs"
    __table_args__ = (
        UniqueConstraint("job_name", "dedupe_key", name="uq_job_once"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(GUID(), index=True, nullable=False)

    # "monthly_accrual" | "late_alert" | "punch_out_nudge"
    job_name: Mapped[str] = mapped_column(String(40), index=True, nullable=False)

    # What makes THIS firing unique: "org:2026-08" for accrual,
    # "BX003:2026-08-28" for the per-person, per-shift-date nudges.
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False)

    # What the run did - counts, the notification written, the reason. An
    # audit answer for "why did/didn't the app nudge me", not just a lock.
    detail: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
