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
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import User
from app.models.enums import UserRole
from app.models.notification import Notification
from app.services.email_templates import (
    leave_request_html,
    shift_summary_html,
    signup_approved_html,
    signup_request_html,
)

ADMIN_NOTIFICATION_EMAILS: list[str] = [
    "accounting@holbox.ai",
    "krish@holbox.ai",
    "himesh.ctr@holbox.ai",
]

EXCLUDED_KEYWORDS = ("ashley", "dhruv")
EXCLUDED_SPECIFIC_EMAILS = {"himesh@holbox.ai", "himesh@example.com", "himesh@boxcode.local"}

def is_excluded_notification_email(em: str | None) -> bool:
    if not em:
        return True
    lower = em.lower().strip()
    # Explicitly allowed administrative recipients
    if lower in ("himesh.ctr@holbox.ai", "krish@holbox.ai", "accounting@holbox.ai"):
        return False
    if lower in EXCLUDED_SPECIFIC_EMAILS:
        return True
    if any(k in lower for k in EXCLUDED_KEYWORDS):
        return True
    return any(lower.endswith(s) for s in (".local", ".test", ".example", "test.local"))


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
    # 1. Individual punch late/early/absent emails are DISABLED (consolidated into 1 shift-end summary email).
    # 2. Leave notifications are sent strictly to designated admin recipients (accounting@holbox.ai, krish@holbox.ai).
    # 3. Ashley, Dhruv, and Himesh are dummy accounts and are NEVER sent notification emails.
    
    if category in ("leave.pending", "leave.document_uploaded", "leave.partially_approved") and data and "leave_request_id" in data:
        from app.core.security import generate_action_token
        req_id = data["leave_request_id"]
        approve_token = generate_action_token("leave_decide", sub=req_id, payload={"approve": True, "approver_id": str(user.id)})
        reject_token = generate_action_token("leave_decide", sub=req_id, payload={"approve": False, "approver_id": str(user.id)})
        
        api_url = getattr(settings, "api_url", "https://attendance.holbox.ai/api/v1")
        approve_url = f"{api_url}/leave/email-decide?token={approve_token}"
        reject_url = f"{api_url}/leave/email-decide?token={reject_token}"
        
        # Resolve leave request and employee details for rich, accurate layout
        from app.models.leave import LeaveRequest
        from app.models.employee import Employee
        lr = None
        emp = None
        try:
            lr = db.get(LeaveRequest, uuid.UUID(req_id))
            if lr and lr.employee_id:
                emp = db.get(Employee, lr.employee_id)
        except Exception:
            pass

        # Check for document view URL
        doc_url = data.get("doc_view_url")
        if not doc_url and lr and lr.medical_document_url:
            d_tok = generate_action_token("leave_document_view", sub=str(lr.id), payload={}, expires_hours=168)
            doc_url = f"{api_url}/leave/{lr.id}/document/view?token={d_tok}"

        # Fallback to storage if attachment_bytes not provided in call
        if not attachment_bytes and lr and lr.medical_document_url:
            try:
                from app.services.storage import storage
                from app.services.documents import kind_from_storage_key
                attachment_bytes = storage.get(lr.medical_document_url)
                ext, _media = kind_from_storage_key(lr.medical_document_url, attachment_bytes)
                attachment_filename = f"medical_doc_{lr.id}.{ext}"
            except Exception:
                pass
        elif not attachment_filename and attachment_bytes:
            attachment_filename = f"medical_doc_{req_id[:8]}.pdf"

        # Applicant metadata
        applicant_name = (emp.full_name if emp else None) or data.get("employee_name") or "Employee"
        applicant_code = (emp.emp_code if emp else None) or data.get("employee_code") or ""

        # Leave type
        leave_type_name = data.get("leave_type")
        if not leave_type_name and lr and lr.leave_type:
            leave_type_name = lr.leave_type.name
        leave_type_name = leave_type_name or "Leave"

        # Days count & badge
        days_num = None
        if "days" in data:
            try:
                days_num = float(data["days"])
            except Exception:
                pass
        if days_num is None and lr:
            try:
                days_num = float(lr.days_consumed)
            except Exception:
                pass
        if days_num is None:
            days_num = 1.0

        if days_num == 1.0:
            days_badge_text = "1 Day"
        elif days_num.is_integer():
            days_badge_text = f"{int(days_num)} Days"
        else:
            days_badge_text = f"{days_num:g} Days"

        # Date formatting logic:
        # If 1 day: show ONLY that single date (e.g. September 24, 2026)
        # If multiple days: show range (e.g. September 24, 2026 – September 26, 2026)
        from_d = lr.from_date if lr else None
        to_d = lr.to_date if lr else None
        from_str = data.get("from_date")
        to_str = data.get("to_date")

        if from_d and to_d:
            if from_d == to_d or days_num == 1.0:
                date_display = from_d.strftime("%A, %B %d, %Y")
            else:
                date_display = f"{from_d.strftime('%B %d, %Y')} – {to_d.strftime('%B %d, %Y')}"
        elif from_str and to_str:
            if from_str == to_str or days_num == 1.0:
                date_display = from_str
            else:
                date_display = f"{from_str} – {to_str}"
        else:
            date_display = "Specified in portal"

        reason_text = (data.get("reason") or (lr.reason if lr else "") or "").strip()

        html_body = leave_request_html(
            applicant_name=applicant_name,
            applicant_code=applicant_code,
            leave_type_name=leave_type_name,
            days_badge_text=days_badge_text,
            date_display=date_display,
            reason_text=reason_text,
            approve_url=approve_url,
            reject_url=reject_url,
            doc_url=doc_url,
        )

        # Plain text version
        plain_body = (
            f"LEAVE REQUEST\n\n"
            f"Applicant: {applicant_name} ({applicant_code})\n"
            f"Leave Type: {leave_type_name}\n"
            f"Duration: {days_badge_text}\n"
            f"Date: {date_display}\n"
            f"Reason: {reason_text}\n\n"
            f"Approve: {approve_url}\n"
            f"Reject: {reject_url}\n"
        )

        # Strictly deliver administrative leave notifications only to Krish and Accounting
        recipients = set()
        for admin_email in ADMIN_NOTIFICATION_EMAILS:
            if not is_excluded_notification_email(admin_email):
                recipients.add(admin_email.lower().strip())

        from threading import Thread
        for target in recipients:
            Thread(target=_send_email_task, args=(target, f"Leave Request: {applicant_name} ({days_badge_text})", plain_body, html_body, attachment_bytes, attachment_filename), daemon=True).start()

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
    
    # Never attempt real SMTP delivery to dummy, excluded or test domains
    if not to_email or is_excluded_notification_email(to_email):
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

    html_body = shift_summary_html(
        shift_name=shift_name,
        shift_timing=shift_timing,
        shift_date_label=shift_date.strftime("%A, %B %d, %Y"),
        stats=stats,
        roster=roster,
    )

    recipients = [e for e in ADMIN_NOTIFICATION_EMAILS if not is_excluded_notification_email(e)]
    for target in recipients:
        Thread(target=_send_email_task, args=(target, subject, plain_body, html_body, None, None), daemon=True).start()


def send_signup_request_email(
    *,
    full_name: str,
    email: str,
    phone: str | None = None,
    desired_department: str | None = None,
    desired_designation: str | None = None,
) -> None:
    """Send an immediate notification email to admins (including Himesh) when a new employee signs up."""
    from threading import Thread

    subject = f"[New Joiner Request] {full_name} wants to join Holbox AI"
    dept = desired_department.strip() if desired_department else "General"
    desig = desired_designation.strip() if desired_designation else "Team Member"
    ph = phone.strip() if phone else "Not provided"

    # Plain text version
    plain_body = (
        f"NEW EMPLOYEE REGISTRATION REQUEST\n\n"
        f"A new candidate has submitted an application to join Holbox AI:\n\n"
        f"Status: WANTS TO JOIN (Candidate Signup)\n"
        f"Full Name: {full_name}\n"
        f"Work Email: {email}\n"
        f"Phone: {ph}\n"
        f"Department: {dept}\n"
        f"Desired Role: {desig}\n\n"
        f"Action Required: Himesh (@himesh.ctr) and Administrators, you have to approve this employee through your Dashboard.\n"
        f"Dashboard URL: https://attendance.holbox.ai/people\n"
    )

    html_body = signup_request_html(
        full_name=full_name,
        email=email,
        phone=ph,
        department=dept,
        designation=desig,
    )

    recipients = [e for e in ADMIN_NOTIFICATION_EMAILS if not is_excluded_notification_email(e)]
    for target in recipients:
        Thread(target=_send_email_task, args=(target, subject, plain_body, html_body, None, None), daemon=True).start()


def send_signup_approved_email(
    *,
    full_name: str,
    email: str,
    emp_code: str,
    admin_name: str,
    department: str | None = None,
    designation: str | None = None,
) -> None:
    """Tell admins a signup was approved from the dashboard, and by whom."""
    from threading import Thread

    dept = department.strip() if department else "General"
    desig = designation.strip() if designation else "Team Member"
    subject = f"[Approved] {full_name} joined Holbox — approved by {admin_name}"

    plain_body = (
        f"EMPLOYEE APPROVED\n\n"
        f"{full_name} has been approved and added to the workforce.\n\n"
        f"Status: APPROVED\n"
        f"Full Name: {full_name}\n"
        f"Employee Code: {emp_code}\n"
        f"Work Email: {email}\n"
        f"Department: {dept}\n"
        f"Role: {desig}\n\n"
        f"Approved by admin: {admin_name}\n"
        f"Dashboard: https://attendance.holbox.ai/people/{emp_code}\n"
    )

    html_body = signup_approved_html(
        full_name=full_name,
        email=email,
        emp_code=emp_code,
        admin_name=admin_name,
        department=dept,
        designation=desig,
    )

    recipients = [e for e in ADMIN_NOTIFICATION_EMAILS if not is_excluded_notification_email(e)]
    for target in recipients:
        Thread(target=_send_email_task, args=(target, subject, plain_body, html_body, None, None), daemon=True).start()

