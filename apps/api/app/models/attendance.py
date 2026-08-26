import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Time,
    UniqueConstraint,
)
from app.db.types import GUID, JSONType
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.enums import AttendanceStatus, PunchDirection, PunchSource


class Device(Base, TimestampMixin):
    """A gate reader. Vendor-specific quirks live in `config`, never in the core."""

    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("locations.id")
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    serial_no: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    vendor: Mapped[str] = mapped_column(String(40), default="zkteco", nullable=False)
    mode: Mapped[str] = mapped_column(String(10), default="push", nullable=False)  # push | pull
    api_key: Mapped[str] = mapped_column(String(64), nullable=False)

    # Readers drift. We record the offset so we can prove which clock was wrong.
    clock_offset_seconds: Mapped[int] = mapped_column(default=0, nullable=False)
    reports_direction: Mapped[bool] = mapped_column(default=False, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    config: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)


class DeviceEnrollment(Base, TimestampMixin):
    """Maps the device's own user id (usually a small int) to our employee.

    This is the mapping every homegrown attendance system forgets, and it is
    why punches show up attached to nobody.
    """

    __tablename__ = "device_enrollments"
    __table_args__ = (
        UniqueConstraint("device_id", "device_user_id", name="uq_device_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("devices.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    device_user_id: Mapped[str] = mapped_column(String(32), nullable=False)


class PunchEvent(Base, TimestampMixin):
    """APPEND ONLY. Never updated, never deleted.

    Corrections are new rows or an AttendanceCorrection record. If you find
    yourself writing an UPDATE against this table, stop.
    """

    __tablename__ = "punch_events"
    __table_args__ = (
        UniqueConstraint("dedupe_hash", name="uq_punch_dedupe"),
        Index("ix_punch_employee_ts", "employee_id", "event_ts_utc"),
        Index("ix_punch_org_ts", "org_id", "event_ts_utc"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("devices.id")
    )

    source: Mapped[PunchSource] = mapped_column(nullable=False)
    direction: Mapped[PunchDirection] = mapped_column(
        default=PunchDirection.UNKNOWN, nullable=False
    )

    # Two clocks: what the device said, and when we actually got it.
    event_ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_ts_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    lat: Mapped[float | None] = mapped_column(Numeric(10, 7))
    lng: Mapped[float | None] = mapped_column(Numeric(10, 7))
    photo_key: Mapped[str | None] = mapped_column(String(400))

    # --- verification, recorded whether or not it passed ---
    # A rejected punch is still stored. Silently dropping them is how you end
    # up unable to explain a missing day three months later.
    geofence_ok: Mapped[bool | None] = mapped_column(nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Numeric(10, 2))
    face_ok: Mapped[bool | None] = mapped_column(nullable=True)
    face_similarity: Mapped[float | None] = mapped_column(Numeric(5, 2))
    rejection_reason: Mapped[str | None] = mapped_column(String(200))
    mobile_device_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("mobile_devices.id")
    )

    raw_payload: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    dedupe_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    is_unmatched: Mapped[bool] = mapped_column(default=False, nullable=False)


class ShiftTemplate(Base, TimestampMixin):
    __tablename__ = "shift_templates"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    break_minutes: Mapped[int] = mapped_column(default=60, nullable=False)
    grace_minutes: Mapped[int] = mapped_column(default=10, nullable=False)
    half_day_after_minutes: Mapped[int] = mapped_column(default=240, nullable=False)
    full_day_after_minutes: Mapped[int] = mapped_column(default=450, nullable=False)

    # For night shifts: punches before this hour belong to the PREVIOUS shift date.
    cutover_hour: Mapped[int] = mapped_column(default=5, nullable=False)
    # Mon=0 .. Sun=6
    working_days: Mapped[list] = mapped_column(JSONType, default=lambda: [0, 1, 2, 3, 4, 5])


class ShiftAssignment(Base, TimestampMixin):
    __tablename__ = "shift_assignments"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    shift_template_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("shift_templates.id"), nullable=False
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)


class AttendanceDay(Base, TimestampMixin):
    """Derived, never authored. Safe to delete and recompute from punch_events."""

    __tablename__ = "attendance_day"
    __table_args__ = (
        UniqueConstraint("employee_id", "shift_date", name="uq_attendance_employee_date"),
        Index("ix_attendance_org_date", "org_id", "shift_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), nullable=False
    )
    shift_date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_template_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("shift_templates.id")
    )

    first_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    worked_minutes: Mapped[int] = mapped_column(default=0, nullable=False)
    break_minutes: Mapped[int] = mapped_column(default=0, nullable=False)
    late_minutes: Mapped[int] = mapped_column(default=0, nullable=False)
    early_out_minutes: Mapped[int] = mapped_column(default=0, nullable=False)
    overtime_minutes: Mapped[int] = mapped_column(default=0, nullable=False)

    status: Mapped[AttendanceStatus] = mapped_column(
        default=AttendanceStatus.NOT_MARKED, nullable=False
    )
    punch_count: Mapped[int] = mapped_column(default=0, nullable=False)
    has_exception: Mapped[bool] = mapped_column(default=False, nullable=False)
    exception_note: Mapped[str | None] = mapped_column(String(300))
    is_regularized: Mapped[bool] = mapped_column(default=False, nullable=False)
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
