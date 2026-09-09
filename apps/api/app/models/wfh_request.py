import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID
from app.models.enums import CorrectionStatus


class WFHRequest(Base, TimestampMixin):
    """Temporary Work-From-Home requests.
    
    Like Leave or Corrections, this records an employee asking to bypass the
    office geofence for a specific shift date.
    """
    __tablename__ = "wfh_requests"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    shift_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    
    status: Mapped[CorrectionStatus] = mapped_column(default=CorrectionStatus.PENDING, nullable=False)
    
    # Audit trail for decisions
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_note: Mapped[str | None] = mapped_column(String(500))
