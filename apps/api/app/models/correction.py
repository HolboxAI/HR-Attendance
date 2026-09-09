"""A correction is a REQUEST for a punch, not the punch itself.

The employee who was actually there is the one who knows what happened, so
they ask; someone else decides. The punch created on approval is ordinary -
source=MANUAL, same as the existing HR-direct path in routes/admin.py - and
the original evidence (or lack of it) is never touched. This table exists so
that "who asked, for what, and who said yes" has somewhere to live that
POST /admin/correct never needed, because on that path HR was both the asker
and the decider.
"""

import uuid
from datetime import datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID
from app.models.enums import CorrectionStatus, PunchDirection


class CorrectionRequest(Base, TimestampMixin):
    __tablename__ = "correction_requests"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )

    shift_date: Mapped[Date] = mapped_column(Date, index=True, nullable=False)
    direction: Mapped[PunchDirection] = mapped_column(nullable=False)
    # What the employee says happened. It is a CLAIM while pending and becomes
    # the punch's event_ts only once someone other than the requester approves
    # it - that approval is what makes a client-supplied time acceptable here
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(120), default="Other", server_default="Other", nullable=False)

    status: Mapped[CorrectionStatus] = mapped_column(
        default=CorrectionStatus.PENDING, index=True, nullable=False
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_note: Mapped[str | None] = mapped_column(Text)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The punch this request produced, once approved. Nullable because a
    # rejected or cancelled request never creates one - the link IS the audit
    # trail from "why does this punch exist" back to "who asked and why".
    punch_event_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("punch_events.id")
    )
