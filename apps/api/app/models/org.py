import uuid

from sqlalchemy import ForeignKey, Numeric, String
from app.db.types import GUID, JSONType
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    country: Mapped[str] = mapped_column(String(2), default="IN", nullable=False)
    settings: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)

    locations: Mapped[list["Location"]] = relationship(back_populates="organization")


class Location(Base, TimestampMixin):
    """One physical site. Geofence is used by mobile punch-in."""

    __tablename__ = "locations"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    address: Mapped[str | None] = mapped_column(String(400))
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7))
    lng: Mapped[float | None] = mapped_column(Numeric(10, 7))
    geofence_radius_m: Mapped[int] = mapped_column(default=150, nullable=False)

    # Presence configuration lives HERE rather than in app/core/office.py,
    # because the PRD is explicit that it must be changeable "per location
    # without code deployment". Coordinates and radius were already read from
    # this table; these two were still a Python constant, which meant
    # registering an access point needed an edit and a restart.
    #
    # A list, not one value: a floor usually has several access points, and a
    # phone roams between them. Registering only the one nearest your desk is
    # how someone gets refused for standing near the stairwell.
    allowed_bssids: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    presence_policy: Mapped[str] = mapped_column(
        String(20), default="wifi_or_gps", nullable=False
    )

    organization: Mapped[Organization] = relationship(back_populates="locations")


class Department(Base, TimestampMixin):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("departments.id")
    )
