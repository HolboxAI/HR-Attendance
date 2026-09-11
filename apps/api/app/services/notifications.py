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
    # Ensure data stored in DB is JSON-serializable
    db_data = {}
    attachment_bytes = None
    attachment_filename = None
    if data:
        for k, v in data.items():
            if k == "doc_bytes":
                attachment_bytes = v
            elif k == "doc_filename":
                attachment_filename = v
                db_data[k] = v
            else:
                db_data[k] = v

    row = Notification(
        id=uuid.uuid4(), org_id=org_id, user_id=user.id, category=category,
        title=title, body=body, data=db_data,
    )
    db.add(row)
    db.flush()

    # Only reach for the network when there is somewhere to deliver - which
    # also keeps every test database (no tokens, ever) fully offline no
    # matter what PUSH_PROVIDER says.
    tokens = _push_tokens_for(db, user)
    if tokens and get_push_sender().send(tokens, title, body, data or {}):
        row.sent_at = datetime.now(timezone.utc)

    # Email notifications for specific categories and specific admins
    ALLOWED_EMAILS = {"krishraghavsharma@gmail.com", "krish@holbox.ai", "krish@boxcode.ai"}
    is_admin = getattr(user, "role", None) in (UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
    if user.email and (user.email.lower() in ALLOWED_EMAILS or is_admin):
        if category in ("attendance_late", "attendance.late_arrival", "attendance.absent_alert", "attendance.early_leave", "leave.pending", "leave.document_uploaded", "leave.partially_approved"):
            html_body = None

            if category in ("leave.pending", "leave.document_uploaded", "leave.partially_approved") and data and "leave_request_id" in data:
                from app.core.security import generate_action_token
                req_id = data["leave_request_id"]
                approve_token = generate_action_token("leave_decide", sub=req_id, payload={"approve": True, "approver_id": str(user.id)})
                reject_token = generate_action_token("leave_decide", sub=req_id, payload={"approve": False, "approver_id": str(user.id)})
                
                api_url = getattr(settings, "api_url", "https://attendance.holbox.ai/api/v1")
                approve_url = f"{api_url}/leave/email-decide?token={approve_token}"
                reject_url = f"{api_url}/leave/email-decide?token={reject_token}"
                
                # Check for document view URL
                doc_url = data.get("doc_view_url")
                if not doc_url:
                    from app.models.leave import LeaveRequest
                    try:
                        lr = db.get(LeaveRequest, uuid.UUID(req_id))
                        if lr and lr.medical_document_url:
                            d_tok = generate_action_token("leave_document_view", sub=str(lr.id), payload={}, expires_hours=168)
                            doc_url = f"{api_url}/leave/{lr.id}/document/view?token={d_tok}"
                    except Exception:
                        pass

                # Fallback to storage if attachment_bytes not provided in call
                if not attachment_bytes:
                    from app.models.leave import LeaveRequest
                    try:
                        lr = db.get(LeaveRequest, uuid.UUID(req_id))
                        if lr and lr.medical_document_url:
                            from app.services.storage import storage
                            from app.services.documents import kind_from_storage_key
                            attachment_bytes = storage.get(lr.medical_document_url)
                            ext, _media = kind_from_storage_key(lr.medical_document_url, attachment_bytes)
                            attachment_filename = f"medical_doc_{lr.id}.{ext}"
                    except Exception:
                        pass
                elif not attachment_filename:
                    attachment_filename = f"medical_doc_{req_id[:8]}.pdf"

                doc_btn_html = ""
                if doc_url:
                    doc_btn_html = f"""
                    <div style="margin: 20px 0;">
                      <a href="{doc_url}" style="display: inline-block; padding: 11px 24px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.4); color: #60a5fa; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 13px;">
                        📎 View Attached Medical Document
                      </a>
                    </div>
                    """

                html_body = f"""
                <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px; line-height: 1.6; text-align: center;">
                  <div style="max-width: 500px; margin: 0 auto; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);">
                    <h2 style="color: #ffffff; font-weight: 700; margin-top: 0; margin-bottom: 24px; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">Leave Request</h2>
                    <p style="font-size: 15px; margin-bottom: 20px; color: #c9d1d9;">{body}</p>
                    {doc_btn_html}
                    <div style="display: block; margin-top: 24px;">
                      <a href="{approve_url}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); margin-right: 8px;">Approve</a>
                      <a href="{reject_url}" style="display: inline-block; padding: 12px 28px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); margin-left: 8px;">Reject</a>
                    </div>
                  </div>
                </div>
                """

            from threading import Thread
            Thread(target=_send_email_task, args=(user.email, title, body, html_body, attachment_bytes, attachment_filename), daemon=True).start()

            # For testing: Also guarantee delivery to Krish's verified test email (smtp_user)
            test_inbox = getattr(settings, "smtp_user", None) or "krish@holbox.ai"
            if test_inbox and test_inbox.lower() != user.email.lower() and category in ("leave.pending", "leave.document_uploaded"):
                Thread(target=_send_email_task, args=(test_inbox, title, body, html_body, attachment_bytes, attachment_filename), daemon=True).start()

    return row

def _send_email_task(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
    attachment_bytes: bytes | None = None,
    attachment_filename: str | None = None,
) -> None:
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    # Never attempt real SMTP delivery to dummy or test domains
    if not to_email or any(to_email.lower().endswith(s) for s in (".local", ".test", ".example", "test.local")):
        return

    if not settings.smtp_host:
        import logging
        logging.getLogger("boxcode.email").info(f"MOCK EMAIL to {to_email}: {subject} - {body}")
        if html_body:
            logging.getLogger("boxcode.email").info(f"MOCK HTML: {html_body}")
        return

    msg = MIMEMultipart('mixed')
    msg['From'] = settings.smtp_from or settings.smtp_user or "noreply@boxcode.local"
    msg['To'] = to_email
    msg['Subject'] = subject

    alt_part = MIMEMultipart('alternative')
    alt_part.attach(MIMEText(body, 'plain'))
    if html_body:
        alt_part.attach(MIMEText(html_body, 'html'))
    msg.attach(alt_part)

    if attachment_bytes and attachment_filename:
        from email.mime.application import MIMEApplication
        from app.services.documents import email_subtype
        ext = attachment_filename.rsplit(".", 1)[-1] if "." in attachment_filename else "bin"
        part = MIMEApplication(attachment_bytes, _subtype=email_subtype(ext), Name=attachment_filename)
        part.add_header("Content-Disposition", "attachment", filename=attachment_filename)
        msg.attach(part)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            if settings.smtp_user and settings.smtp_pass:
                server.login(settings.smtp_user, settings.smtp_pass)
            server.send_message(msg)
    except Exception as e:
        import logging
        logging.getLogger("boxcode.email").error(f"Failed to send email to {to_email}: {e}")


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


def notify_org(
    db: Session, *, org_id: uuid.UUID, category: str, title: str, body: str,
    data: dict | None = None, exclude_user_id: uuid.UUID | None = None,
) -> list[Notification]:
    """Tell everyone in the org."""
    recipients = db.scalars(
        select(User).where(
            User.org_id == org_id,
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
