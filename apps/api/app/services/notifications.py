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

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import User
from app.models.enums import UserRole
from app.models.notification import Notification


class PushSender:
    def send(self, tokens: list[str], title: str, body: str, data: dict) -> bool:
        """Return True if a push was actually dispatched."""
        raise NotImplementedError


class NullPushSender(PushSender):
    """No push configured. The row is the notification."""

    def send(self, tokens: list[str], title: str, body: str, data: dict) -> bool:
        return False


class ExpoPushSender(PushSender):
    """Hands the message to Expo's push service, which hands it to FCM/APNs.

    One HTTPS call, no account or key needed - the ExponentPushToken the
    phone registered IS the address and the authorisation. Failure here is
    swallowed after logging: the PRD's rule is that the row is the
    notification and the banner is a courtesy, so a push outage must never
    break the approval or nudge that triggered it.
    """

    URL = "https://exp.host/--/api/v2/push/send"

    def send(self, tokens: list[str], title: str, body: str, data: dict) -> bool:
        import httpx

        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "data": data,
                "sound": "default",
                "priority": "high",
                # The Android channel the app creates on first run - HIGH
                # importance, so an attendance nudge is a banner, not a
                # silent tray entry.
                "channelId": "attendance",
            }
            for token in tokens
        ]
        try:
            resp = httpx.post(self.URL, json=messages, timeout=5.0)
            resp.raise_for_status()
            tickets = resp.json().get("data", [])
            ok = any(t.get("status") == "ok" for t in tickets)
            for t in tickets:
                if t.get("status") != "ok":
                    logging.getLogger("boxcode.push").warning(
                        "expo push refused: %s", t.get("message", t)
                    )
            return ok
        except Exception:                 # noqa: BLE001 - courtesy, not truth
            logging.getLogger("boxcode.push").warning(
                "expo push unreachable - the notification row still exists",
                exc_info=True,
            )
            return False


def get_push_sender() -> PushSender:
    if settings.push_provider == "expo":
        return ExpoPushSender()
    return NullPushSender()


def _push_tokens_for(db: Session, user: User) -> list[str]:
    """The push addresses of this person's ACTIVE devices.

    Token lives on the MobileDevice binding row, so an unbound phone stops
    receiving the moment HR clears it - no separate revocation to forget.
    """
    if user.employee_id is None:
        return []
    from app.models.face import MobileDevice
    rows = db.scalars(
        select(MobileDevice).where(
            MobileDevice.employee_id == user.employee_id,
            MobileDevice.is_active.is_(True),
            MobileDevice.push_token.is_not(None),
        )
    ).all()
    return [r.push_token for r in rows if r.push_token]


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

    # Only reach for the network when there is somewhere to deliver - which
    # also keeps every test database (no tokens, ever) fully offline no
    # matter what PUSH_PROVIDER says.
    tokens = _push_tokens_for(db, user)
    if tokens and get_push_sender().send(tokens, title, body, data or {}):
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


def resolve_matching(
    db: Session, *, org_id: uuid.UUID, category: str, data_key: str, data_value: str,
) -> int:
    """Mark every copy of one actionable notification read, org-wide.

    "Karan needs a correction" fans out to every admin; once ONE of them
    decides it, the item is dealt with for all of them, and an inbox that
    keeps nagging about finished work teaches people to ignore it. Marked
    read, never deleted - the row stays as the record that they were told.
    The data filter runs in Python because `data` is a JSON column and this
    fires once per decision over at most a screenful of unread rows.
    """
    rows = db.scalars(
        select(Notification).where(
            Notification.org_id == org_id,
            Notification.category == category,
            Notification.read_at.is_(None),
        )
    ).all()
    cleared = 0
    for row in rows:
        if str((row.data or {}).get(data_key)) == str(data_value):
            row.read_at = datetime.now(timezone.utc)
            cleared += 1
    if cleared:
        db.flush()
    return cleared
