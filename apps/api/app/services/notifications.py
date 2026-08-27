"""Telling someone something happened, and remembering that they were told.

Two halves, deliberately separable - the same shape as app/services/face.py's
stub/real split. `notify()` always writes the row; a client can list "what
needs my attention" with zero external dependencies. Sending an actual push is
a second, independent step behind PushSender, and NullPushSender - today's
default - simply does not ring anyone's phone. Nothing about the record is
weaker for it.

FACE_PROVIDER=stub meant "the plumbing is real, the matching is not". The same
sentence applies here: the notification EXISTS, is queryable, and is not lost.
Whether it also buzzed a pocket is a separate, swappable concern - wire
ExpoPushSender in when there is a real device population and an Expo push
token worth spending API calls on.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import User
from app.models.enums import UserRole
from app.models.notification import Notification


class PushSender:
    def send(self, user: User, title: str, body: str, data: dict) -> bool:
        """Return True if a push was actually dispatched."""
        raise NotImplementedError


class NullPushSender(PushSender):
    """No device population to push to yet. The row is the notification."""

    def send(self, user: User, title: str, body: str, data: dict) -> bool:
        return False


def get_push_sender() -> PushSender:
    if settings.push_provider == "expo":
        # Not implemented: no Expo access token configured yet, and building
        # it against a fleet of zero registered devices would be untestable
        # theatre. The seam is here so wiring it in later is one class, the
        # same trade this codebase already made for face matching and photo
        # storage.
        raise NotImplementedError(
            "PUSH_PROVIDER=expo has no implementation yet - see notifications.py"
        )
    return NullPushSender()


def notify(
    db: Session, *, org_id: uuid.UUID, user: User, category: str,
    title: str, body: str, data: dict | None = None,
) -> Notification:
    row = Notification(
        id=uuid.uuid4(), org_id=org_id, user_id=user.id, category=category,
        title=title, body=body, data=data or {},
    )
    db.add(row)
    db.flush()

    if get_push_sender().send(user, title, body, data or {}):
        row.sent_at = datetime.now(timezone.utc)
    return row


def notify_hr(
    db: Session, *, org_id: uuid.UUID, category: str, title: str, body: str,
    data: dict | None = None, exclude_user_id: uuid.UUID | None = None,
) -> list[Notification]:
    """Tell everyone who can act on this, not one designated inbox.

    Boxcode has one or two HR admins today; a category that only reached a
    single hardcoded person would quietly go dark the day that person is on
    leave. exclude_user_id keeps someone from being notified about their own
    action - relevant once an hr_admin can also submit a correction.
    """
    recipients = db.scalars(
        select(User).where(
            User.org_id == org_id,
            User.role.in_([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]),
            User.is_active.is_(True),
        )
    ).all()
    return [
        notify(db, org_id=org_id, user=u, category=category, title=title,
              body=body, data=data)
        for u in recipients
        if u.id != exclude_user_id
    ]


def unread_count(db: Session, user: User) -> int:
    return len(db.scalars(
        select(Notification).where(
            Notification.user_id == user.id, Notification.read_at.is_(None),
        )
    ).all())


def mark_read(db: Session, *, notification: Notification) -> None:
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.flush()
