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

ADMIN_NOTIFICATION_EMAILS: list[str] = [
    "accounting@holbox.ai",
    "krish@holbox.ai",
]

def is_excluded_notification_email(em: str | None) -> bool:
    if not em:
        return True
    lower = em.lower().strip()
    return "ashley" in lower or any(lower.endswith(s) for s in (".local", ".test", ".example", "test.local"))


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

    # Email notifications:
    # 1. Individual punch-level late/early/absent emails are DISABLED to prevent inbox spam.
    #    (They are now consolidated into exactly 1 shift-end summary email at the end of the day).
    # 2. Leave notifications are sent to designated admin recipients (accounting@holbox.ai, krish@holbox.ai).
    # 3. Ashley is NEVER sent notification emails per senior instructions.
    
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

        reason_text = (data.get("reason") or "").strip()
        reason_html = ""
        if reason_text:
            reason_html = f"""
            <div style="background: rgba(255, 255, 255, 0.05); border-left: 3px solid #3b82f6; border-radius: 8px; padding: 14px 18px; margin: 20px 0; text-align: left;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; font-weight: 700; margin-bottom: 6px;">Reason for Leave</div>
              <div style="font-size: 14px; color: #f1f5f9; line-height: 1.5;">"{reason_text}"</div>
            </div>
            """

        clean_body = body.split("\n\nReason:")[0] if "\n\nReason:" in body else body
        html_body = f"""
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px 20px; line-height: 1.6; text-align: center;">
          <div style="max-width: 520px; margin: 0 auto; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 32px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);">
            <h2 style="color: #ffffff; font-weight: 700; margin-top: 0; margin-bottom: 24px; font-size: 20px; text-transform: uppercase; letter-spacing: 1px;">Leave Request</h2>
            <p style="font-size: 15px; margin-bottom: 16px; color: #c9d1d9;">{clean_body}</p>
            {reason_html}
            {doc_btn_html}
            <div style="display: block; margin-top: 24px;">
              <a href="{approve_url}" style="display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); margin-right: 8px;">Approve</a>
              <a href="{reject_url}" style="display: inline-block; padding: 12px 28px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); margin-left: 8px;">Reject</a>
            </div>
          </div>
        </div>
        """

        recipients = set()
        if user.email and not is_excluded_notification_email(user.email):
            is_admin = getattr(user, "role", None) in (UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
            if is_admin:
                recipients.add(user.email.lower().strip())

        for admin_email in ADMIN_NOTIFICATION_EMAILS:
            recipients.add(admin_email.lower().strip())

        # Strictly purge any Ashley address from receiving email
        recipients = {e for e in recipients if not is_excluded_notification_email(e)}

        from threading import Thread
        for target in recipients:
            Thread(target=_send_email_task, args=(target, title, body, html_body, attachment_bytes, attachment_filename), daemon=True).start()

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


def send_shift_summary_email(
    *,
    shift_name: str,
    shift_timing: str,
    shift_date: date,
    stats: dict,
    roster: list[dict],
) -> None:
    """Send exactly 1 consolidated, modern HTML attendance summary email at shift end."""
    from threading import Thread

    subject = f"[Attendance Summary] {shift_name} ({shift_timing}) — {shift_date.strftime('%d %b %Y')}"

    # Plain text version
    lines = [
        f"Attendance Summary: {shift_name} ({shift_timing})",
        f"Date: {shift_date.strftime('%A, %B %d, %Y')}",
        "",
        f"Scheduled: {stats.get('total', 0)} | Present: {stats.get('present', 0)} | Late: {stats.get('late', 0)} | Absent: {stats.get('absent', 0)} | On Leave: {stats.get('leave', 0)}",
        "",
        "Employee Attendance Roster:",
        "-" * 65,
    ]
    for r in roster:
        lines.append(
            f"- {r['name']} ({r['code']}): {r['status'].upper()} | In: {r['first_in']} | Out: {r['last_out']} | Late: {r['late_str']} | Worked: {r.get('hours_str', '-')}"
        )
    plain_body = "\n".join(lines)

    # Rich HTML table rows
    rows_html = ""
    for r in roster:
        st = r['status'].lower()
        if st in ("present", "early"):
            status_color = "#10b981"
            status_bg = "rgba(16, 185, 129, 0.15)"
        elif st in ("late", "half_day"):
            status_color = "#f59e0b"
            status_bg = "rgba(245, 158, 11, 0.15)"
        elif st in ("absent",):
            status_color = "#ef4444"
            status_bg = "rgba(239, 68, 68, 0.15)"
        elif st in ("on_leave", "leave"):
            status_color = "#3b82f6"
            status_bg = "rgba(59, 130, 246, 0.15)"
        else:
            status_color = "#94a3b8"
            status_bg = "rgba(148, 163, 184, 0.15)"

        late_badge = (
            f'<span style="color: #f59e0b; font-weight: 700;">{r["late_str"]}</span>'
            if r.get("late_minutes", 0) > 0
            else '<span style="color: #64748b;">On Time</span>'
        )

        rows_html += f"""
        <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
          <td style="padding: 12px 14px; font-weight: 600; color: #f8fafc;">
            {r['name']} <span style="font-size: 11px; font-family: monospace; color: #94a3b8; margin-left: 4px;">({r['code']})</span>
          </td>
          <td style="padding: 12px 14px;">
            <span style="display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: {status_bg}; color: {status_color};">
              {r['status'].replace('_', ' ')}
            </span>
          </td>
          <td style="padding: 12px 14px; color: #cbd5e1; font-family: monospace; font-size: 12px;">{r['first_in']}</td>
          <td style="padding: 12px 14px; color: #cbd5e1; font-family: monospace; font-size: 12px;">{r['last_out']}</td>
          <td style="padding: 12px 14px; font-size: 12px;">{late_badge}</td>
          <td style="padding: 12px 14px; color: #94a3b8; font-size: 12px;">{r.get('hours_str', '-')}</td>
        </tr>
        """

    html_body = f"""
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f17; color: #cbd5e1; padding: 32px 16px; line-height: 1.5;">
      <div style="max-width: 680px; margin: 0 auto; background: #111827; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 28px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);">
        
        <!-- Header -->
        <div style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 20px; margin-bottom: 24px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #3b82f6; margin-bottom: 6px;">Daily Shift Attendance Summary</div>
          <h1 style="color: #ffffff; font-size: 22px; font-weight: 700; margin: 0 0 6px 0;">{shift_name} Shift</h1>
          <div style="font-size: 13px; color: #94a3b8;">
            📅 {shift_date.strftime('%A, %B %d, %Y')} &nbsp;&bull;&nbsp; ⏰ {shift_timing}
          </div>
        </div>

        <!-- Metrics Cards -->
        <div style="display: flex; gap: 8px; margin-bottom: 26px;">
          <div style="flex: 1; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 12px 8px; text-align: center;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; font-weight: 600;">Scheduled</div>
            <div style="font-size: 20px; font-weight: 700; color: #f8fafc; margin-top: 4px;">{stats.get('total', 0)}</div>
          </div>
          <div style="flex: 1; background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 12px 8px; text-align: center;">
            <div style="font-size: 10px; text-transform: uppercase; color: #10b981; font-weight: 600;">Present</div>
            <div style="font-size: 20px; font-weight: 700; color: #10b981; margin-top: 4px;">{stats.get('present', 0)}</div>
          </div>
          <div style="flex: 1; background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; padding: 12px 8px; text-align: center;">
            <div style="font-size: 10px; text-transform: uppercase; color: #f59e0b; font-weight: 600;">Late</div>
            <div style="font-size: 20px; font-weight: 700; color: #f59e0b; margin-top: 4px;">{stats.get('late', 0)}</div>
          </div>
          <div style="flex: 1; background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 12px 8px; text-align: center;">
            <div style="font-size: 10px; text-transform: uppercase; color: #ef4444; font-weight: 600;">Absent</div>
            <div style="font-size: 20px; font-weight: 700; color: #ef4444; margin-top: 4px;">{stats.get('absent', 0)}</div>
          </div>
          <div style="flex: 1; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; padding: 12px 8px; text-align: center;">
            <div style="font-size: 10px; text-transform: uppercase; color: #60a5fa; font-weight: 600;">On Leave</div>
            <div style="font-size: 20px; font-weight: 700; color: #60a5fa; margin-top: 4px;">{stats.get('leave', 0)}</div>
          </div>
        </div>

        <!-- Roster Table -->
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
          <thead>
            <tr style="border-bottom: 2px solid rgba(255, 255, 255, 0.1); color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">
              <th style="padding: 10px 14px;">Employee</th>
              <th style="padding: 10px 14px;">Status</th>
              <th style="padding: 10px 14px;">In</th>
              <th style="padding: 10px 14px;">Out</th>
              <th style="padding: 10px 14px;">Late (Mins)</th>
              <th style="padding: 10px 14px;">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows_html}
          </tbody>
        </table>

        <!-- Footer -->
        <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.08); text-align: center; font-size: 12px; color: #64748b;">
          Holbox AI HRMS &bull; Sent automatically at shift end &bull; <a href="https://attendance.holbox.ai" style="color: #3b82f6; text-decoration: none;">View Dashboard</a>
        </div>

      </div>
    </div>
    """

    recipients = ["accounting@holbox.ai", "krish@holbox.ai"]
    for target in recipients:
        Thread(target=_send_email_task, args=(target, subject, plain_body, html_body, None, None), daemon=True).start()
