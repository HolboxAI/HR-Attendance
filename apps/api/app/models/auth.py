import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID


class RefreshSession(Base, TimestampMixin):
    """One row per issued refresh token, so logout can actually mean something.

    A JWT is self-validating, which is the point of it and also the problem: on
    its own it stays valid until it expires, and "log me out of my old phone"
    is a request we have to be able to honour. So the long-lived half is
    recorded here and checked on every refresh. The short-lived access token is
    NOT recorded - checking it against the database on every request would give
    up the only thing JWTs are good for.

    The row is kept after revocation rather than deleted. Which sessions
    existed, and when they ended, is exactly the sort of thing you want on the
    day you are trying to work out how someone got in.
    """

    __tablename__ = "refresh_sessions"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True)   # the token's jti
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Which install this session belongs to, so revoking a device binding can
    # take its sessions with it.
    install_id: Mapped[str | None] = mapped_column(String(128), index=True)
