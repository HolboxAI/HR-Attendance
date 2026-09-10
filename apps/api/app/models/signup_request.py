import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID
from app.models.enums import SignupStatus


class SignupRequest(Base, TimestampMixin):
    """Self-service employee signup requests waiting for HR approval.
    
    A candidate registers via /signup with their credentials and personal info.
    Once HR approves in the Directory or Notifications, an Employee and User
    are created using their supplied password_hash, and this record is marked APPROVED.
    """
    __tablename__ = "signup_requests"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    desired_department: Mapped[str | None] = mapped_column(String(120))
    desired_designation: Mapped[str | None] = mapped_column(String(120))

    status: Mapped[SignupStatus] = mapped_column(
        default=SignupStatus.PENDING, nullable=False, index=True
    )

    # Decision audit trail
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(String(500))

    # Created employee record when approved
    created_employee_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("employees.id")
    )
