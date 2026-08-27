"""What someone was told, and whether they have seen it.

Built as a record first, a push second - on purpose. The PRD itself says
"notifications must never be the sole source of truth", so the row that lets
someone see "3 things need your attention" inside the product is the part that
has to exist unconditionally. Actually ringing a phone is the part that can be
stubbed, swapped, or simply not fire, without anything going quiet forever.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID, JSONType


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    # The USER, not the employee. HR admins without a punch-side employee
    # record still need to be told a correction is waiting for them.
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id"), index=True, nullable=False
    )

    # A short machine key ("correction.submitted"), not free text, so the
    # eventual mobile app can pick an icon or route a tap without parsing
    # English.
    category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Whatever the tap target needs - a correction id, a leave request id.
    data: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)

    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set even when nothing was actually pushed (see NullPushSender), so
    # "delivered" and "read" stay honestly different questions.
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
