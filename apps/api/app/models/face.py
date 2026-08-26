import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from app.db.types import GUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class FaceEnrollment(Base, TimestampMixin):
    """The reference photo a punch selfie is compared against.

    We store the S3 key, never the image bytes, and never a face embedding -
    Rekognition holds no state for 1:1 CompareFaces, which keeps this simple
    and keeps biometric data out of our database.

    Re-enrolment is a new row: people change, and we want the history of who
    approved each reference photo.
    """

    __tablename__ = "face_enrollments"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    photo_key: Mapped[str] = mapped_column(String(400), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    enrolled_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id")
    )
    enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MobileDevice(Base, TimestampMixin):
    """Device binding: one phone per employee.

    Cheap defence against a second person punching from their own handset. If
    someone genuinely changes phone, HR clears the binding - which leaves an
    audit trail, which is the whole point.
    """

    __tablename__ = "mobile_devices"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    install_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)   # ios | android
    model: Mapped[str | None] = mapped_column(String(80))
    push_token: Mapped[str | None] = mapped_column(String(400))
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
