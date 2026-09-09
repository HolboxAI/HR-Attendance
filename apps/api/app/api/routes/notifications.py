"""What a signed-in user has been told.

One endpoint, shared by every role, because "things needing my attention" is
not an admin-only idea. This is deliberately not a push-notification API - it
is the record that has to exist unconditionally per app/services/notifications.py,
and it is what the PRD means by "every actionable item must remain visible
inside the product" even when nothing rang a phone.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import UserRole
from app.models.notification import Notification
from app.services import notifications as notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: uuid.UUID
    category: str
    title: str
    body: str
    data: dict
    read: bool
    sent: bool
    created_at: str


def _out(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id, category=n.category, title=n.title, body=n.body, data=n.data,
        read=n.read_at is not None, sent=n.sent_at is not None,
        created_at=n.created_at.isoformat(),
    )


@router.get("", response_model=list[NotificationOut])
def list_mine(
    unread_only: bool = Query(default=False),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = db.scalars(
        stmt.order_by(Notification.created_at.desc(), Notification.updated_at.desc()).limit(200)
    ).all()
    return [_out(n) for n in rows]


@router.get("/unread-count")
def count(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return {"unread": notification_service.unread_count(db, user)}


class SendMessageIn(BaseModel):
    employee_code: str
    message: str = Field(min_length=1, max_length=1000)


@router.post("/send", response_model=NotificationOut)
def send_message(
    body: SendMessageIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.MANAGER)),
):
    """A manual message into one employee's inbox - "you forgot to punch out,
    come see me", typed by a human.

    Scoped exactly like the board: a manager reaches their reports, HR reaches
    everyone. It rides the same notification rail as everything else, so the
    row is queryable forever and will ring a phone the day push is wired -
    nothing about being handwritten makes it a different kind of message.
    """
    from app.api.routes.admin import visible_employees

    code = body.employee_code.upper()
    emp = next((e for e in visible_employees(db, actor) if e.emp_code == code), None)
    if emp is None:
        # Same shape as the employee routes: whether a code exists is not
        # information an out-of-scope caller gets to confirm.
        raise HTTPException(404, f"No employee {code} in your scope")

    target = db.scalar(select(User).where(
        User.employee_id == emp.id, User.is_active.is_(True),
    ))
    if target is None:
        raise HTTPException(409, f"{emp.full_name} has no login to deliver to")

    sender = db.get(Employee, actor.employee_id) if actor.employee_id else None
    sender_name = sender.full_name if sender else actor.email
    row = notification_service.notify(
        db, org_id=actor.org_id, user=target, category="message",
        title=f"Message from {sender_name}", body=body.message,
        data={"from": sender.emp_code if sender else actor.email},
    )
    db.commit()
    return _out(row)


class ReplyIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


@router.post("/{notification_id}/reply", response_model=NotificationOut)
def reply_to_message(
    notification_id: uuid.UUID,
    body: ReplyIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Answer a manual message from your own inbox.

    /send is manager+ because reaching an ARBITRARY employee is a board-scoped
    power. Replying is not that: the recipient is fixed - whoever wrote to you,
    named in the message's own `data.from` - so any employee may do it without
    gaining the ability to message anyone else. Replies carry `data.from` too,
    which is what lets the other side reply back: a thread with no thread
    table, just the rail both directions already ride.
    """
    original = db.get(Notification, notification_id)
    if original is None or original.user_id != user.id:
        raise HTTPException(404, "No such notification")
    if original.category != "message":
        raise HTTPException(409, "Only messages can be replied to")

    sender_ref = str((original.data or {}).get("from") or "")
    if not sender_ref:
        raise HTTPException(409, "This message does not say who sent it")

    # `from` is an emp_code when the sender had an employee row, their email
    # when they did not (a pure admin account).
    target: User | None = None
    emp = db.scalar(select(Employee).where(
        Employee.org_id == user.org_id, Employee.emp_code == sender_ref.upper(),
    ))
    if emp is not None:
        target = db.scalar(select(User).where(
            User.employee_id == emp.id, User.is_active.is_(True),
        ))
    else:
        target = db.scalar(select(User).where(
            User.org_id == user.org_id, User.email == sender_ref,
            User.is_active.is_(True),
        ))
    if target is None:
        raise HTTPException(409, "The sender no longer has an account to reply to")

    me = db.get(Employee, user.employee_id) if user.employee_id else None
    my_name = me.full_name if me else user.email
    row = notification_service.notify(
        db, org_id=user.org_id, user=target, category="message",
        title=f"Reply from {my_name}", body=body.message,
        data={"from": me.emp_code if me else user.email,
              "reply_to": str(original.id)},
    )
    # Replying is the strongest possible proof the message was read.
    notification_service.mark_read(db, notification=original)
    db.commit()
    return _out(row)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: uuid.UUID,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "No such notification")
    notification_service.mark_read(db, notification=row)
    db.commit()
    return _out(row)
