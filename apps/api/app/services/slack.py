import hashlib
import hmac
import logging
import time
from datetime import date
from urllib.parse import urlencode

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def upload_document_to_slack(
    *,
    filename: str,
    data: bytes,
    channel: str,
    thread_ts: str | None = None,
    title: str = "Medical document",
) -> None:
    """Put the actual file in Slack so HR does not depend on the API link.

    The chat message still carries a view URL; this is the copy that opens
    inside Slack even when API_URL is wrong, HTTP-only, or the token expired.
    """
    if not settings.slack_bot_token:
        return
    payload: dict[str, str] = {
        "channels": channel,
        "filename": filename,
        "title": title,
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts
    try:
        resp = httpx.post(
            "https://slack.com/api/files.upload",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            data=payload,
            files={"file": (filename, data)},
            timeout=20.0,
        )
        body = resp.json()
        if not body.get("ok"):
            logger.warning("Slack file upload failed: %s", body.get("error"))
    except Exception as e:
        logger.warning("Slack file upload error: %s", e)


def verify_slack_signature(
    signature: str, timestamp: str, body: bytes, signing_secret: str
) -> bool:
    """Verify that a webhook actually came from Slack."""
    # Prevent replay attacks by checking timestamp is recent (within 5 mins)
    if abs(time.time() - int(timestamp)) > 60 * 5:
        return False
        
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    my_signature = (
        "v0="
        + hmac.new(
            signing_secret.encode("utf-8"),
            sig_basestring.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
    )
    return hmac.compare_digest(my_signature, signature)


def post_leave_request(
    leave_request_id: str,
    employee_name: str,
    leave_type: str,
    from_date: date,
    to_date: date,
    days: float,
    reason: str,
    document_url: str | None = None,
    document_bytes: bytes | None = None,
    document_filename: str | None = None,
    is_sick_leave: bool = False,
) -> tuple[str, str] | None:
    """Post an interactive leave request message to Slack. Returns (ts, channel_id)."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        logger.info("Slack bot not configured. Skipping leave request notification.")
        return None

    doc_part = f"\n📎 *Attached Document:* <{document_url}|Click to View Document>" if document_url else ""
    mrkdwn_text = (
        f"🌴 *Leave Request: {employee_name}*\n"
        f"Requested *{days:g} days* of {leave_type} from {from_date} to {to_date}.\n"
        f"📝 *Reason:* {reason}"
        f"{doc_part}"
    )

    elements = [
        {
            "type": "button",
            "text": {
                "type": "plain_text",
                "text": "Approve",
                "emoji": True
            },
            "style": "primary",
            "value": f"approve:{leave_request_id}",
            "action_id": "approve_leave"
        }
    ]

    # Only provide Partial Approve for Sick Leave
    if is_sick_leave:
        elements.append({
            "type": "button",
            "text": {
                "type": "plain_text",
                "text": "Partial Approve",
                "emoji": True
            },
            "value": f"partial_approve:{leave_request_id}",
            "action_id": "partial_approve_leave"
        })

    elements.append({
        "type": "button",
        "text": {
            "type": "plain_text",
            "text": "Reject",
            "emoji": True
        },
        "style": "danger",
        "value": f"reject:{leave_request_id}",
        "action_id": "reject_leave"
    })

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": mrkdwn_text
            }
        },
        {
            "type": "actions",
            "elements": elements
        }
    ]

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"Leave Request from {employee_name}",
                "blocks": blocks,
            },
            timeout=5.0,
        )
        response.raise_for_status()
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error: {res_data.get('error')}")
            return None

        ts, channel = res_data.get("ts"), res_data.get("channel")
        if document_bytes and document_filename and channel:
            upload_document_to_slack(
                filename=document_filename,
                data=document_bytes,
                channel=channel,
                thread_ts=ts,
                title=f"Medical document — {employee_name}",
            )
        return ts, channel
    except Exception as e:
        logger.error(f"Failed to post leave request to Slack: {e}")
        return None


def update_leave_request(
    channel_id: str,
    message_ts: str,
    original_text: str,
    approved: bool,
    actor_name: str,
    partial_approve: bool = False,
    note: str | None = None,
) -> None:
    """Update a leave request message to remove buttons after it is decided."""
    if not settings.slack_bot_token:
        return

    if partial_approve:
        note_str = f'\n> Note: "{note}"' if note else ""
        status_text = f"⚠️ *Partially Approved by @{actor_name}* (Medical Certificate Requested){note_str}"
    elif approved:
        status_text = f"✅ *Approved by @{actor_name}*"
    else:
        status_text = f"❌ *Rejected by @{actor_name}*"

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{original_text}\n\n_{status_text}_"
            }
        }
    ]

    try:
        httpx.post(
            "https://slack.com/api/chat.update",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": channel_id,
                "ts": message_ts,
                "text": "Leave Request Decided",
                "blocks": blocks,
            },
            timeout=5.0,
        )
    except Exception as e:
        logger.error(f"Failed to update Slack message: {e}")


def sync_leave_decision_to_slack(
    channel_id: str,
    message_ts: str,
    employee_name: str,
    leave_type_name: str,
    from_date: date,
    to_date: date,
    days: float,
    reason: str,
    approved: bool,
    actor_name: str,
    source: str = "Email",
    partial_approve: bool = False,
    note: str | None = None,
) -> None:
    """Sync a decision made outside of Slack (e.g. Email or Portal) to Slack."""
    if not settings.slack_bot_token:
        return

    if "cancel" in (note or "").lower():
        status_text = f"🚫 *Cancelled by @{actor_name}*"
        action_label = "Cancelled"
    elif partial_approve:
        note_str = f'\n> Admin Note: "{note}"' if note else ""
        status_text = f"⚠️ Partially Approved via {source} by @{actor_name} (Awaiting Medical Document){note_str}"
        action_label = "Partially Approved"
    elif approved:
        status_text = f"✅ Approved via {source} by @{actor_name}"
        action_label = "Approved"
    else:
        status_text = f"❌ Rejected via {source} by @{actor_name}"
        action_label = "Rejected"

    original_text = (
        f"🌴 *Leave Request: {employee_name}*\n"
        f"Requested *{days:g} days* of {leave_type_name} from {from_date} to {to_date}.\n"
        f"> \"{reason}\""
    )

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{original_text}\n\n_{status_text}_"
            }
        }
    ]

    try:
        httpx.post(
            "https://slack.com/api/chat.update",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": channel_id,
                "ts": message_ts,
                "text": f"Leave Request {action_label}",
                "blocks": blocks,
            },
            timeout=5.0,
        )
    except Exception as e:
        logger.error(f"Failed to sync leave decision to Slack: {e}")



def post_document_uploaded_alert(
    leave_request_id: str,
    employee_name: str,
    leave_type_name: str,
    from_date: date,
    to_date: date,
    document_url: str,
    document_bytes: bytes | None = None,
    document_filename: str | None = None,
    original_channel_id: str | None = None,
    original_thread_ts: str | None = None,
) -> None:
    """Alert Slack admin channel that an employee has uploaded their medical certificate."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    channel = original_channel_id or settings.slack_channel_id
    text_content = (
        f"📄 *Medical Certificate Uploaded: {employee_name}*\n"
        f"Employee has submitted medical documentation for *{leave_type_name}* ({from_date} to {to_date}).\n"
        f"📎 *Medical Document:* <{document_url}|Click Here to View Document>"
    )

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": text_content,
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Approve Leave", "emoji": True},
                    "style": "primary",
                    "value": f"approve:{leave_request_id}",
                    "action_id": "approve_leave",
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Reject", "emoji": True},
                    "style": "danger",
                    "value": f"reject:{leave_request_id}",
                    "action_id": "reject_leave",
                },
            ],
        },
    ]

    try:
        httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": channel,
                "thread_ts": original_thread_ts,
                "text": f"Medical document submitted by {employee_name}",
                "blocks": blocks,
            },
            timeout=5.0,
        )
        if document_bytes and document_filename:
            upload_document_to_slack(
                filename=document_filename,
                data=document_bytes,
                channel=channel,
                thread_ts=original_thread_ts,
                title=f"Medical document — {employee_name}",
            )
    except Exception as e:
        logger.error(f"Failed to post document uploaded alert to Slack: {e}")


def post_absence_alert(employee_name: str, shift_start: str) -> None:
    """Post an absence alert to Slack."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"⚠️ *Absence Alert:* {employee_name} has not checked in today (Shift started at {shift_start}).",
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post absence alert to Slack: {e}")

def post_reply(channel_id: str, message: str, thread_ts: str | None = None) -> None:
    """Post a generic reply message to Slack (optionally in a thread)."""
    if not settings.slack_bot_token:
        return

    payload = {
        "channel": channel_id,
        "text": message,
    }
    if thread_ts:
        payload["thread_ts"] = thread_ts

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json=payload,
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error in post_reply: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post reply to Slack: {e}")

def format_duration_human(minutes: int) -> str:
    """Format minutes into human-readable hours and minutes.
    Examples:
        127 -> "2 hours 7 minutes"
        60  -> "1 hour"
        61  -> "1 hour 1 minute"
        45  -> "45 minutes"
        1   -> "1 minute"
        0   -> "0 minutes"
    """
    if minutes <= 0:
        return "0 minutes"
    h = minutes // 60
    m = minutes % 60
    if h == 0:
        return f"{m} minute{'s' if m != 1 else ''}"
    hour_part = f"{h} hour{'s' if h != 1 else ''}"
    if m == 0:
        return hour_part
    return f"{hour_part} {m} minute{'s' if m != 1 else ''}"


def post_late_arrival_alert(employee_name: str, arrive_time: str, late_minutes: int, shift_date: str) -> None:
    """Post a late arrival alert to Slack."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    dur_str = format_duration_human(late_minutes)
    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"⏳ *Late Arrival:* {employee_name} arrived late at {arrive_time} ({dur_str} late) for their shift on {shift_date}.",
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error in post_late_arrival_alert: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post late arrival alert to Slack: {e}")


def post_early_leave_alert(employee_name: str, leave_time: str, early_minutes: int, shift_date: str) -> None:
    """Post an early leave alert to Slack."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    dur_str = format_duration_human(early_minutes)
    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"🏃 *Early Leave:* {employee_name} left early at {leave_time} ({dur_str} early) for their shift on {shift_date}.",
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error in post_early_leave_alert: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post early leave alert to Slack: {e}")


def post_signup_request_alert(
    full_name: str,
    email: str,
    phone: str | None = None,
    department: str | None = None,
    designation: str | None = None,
    signup_id: str | None = None,
) -> tuple[str, str] | None:
    """Post an alert when a candidate submits an employee signup request.

    Returns (message_ts, channel_id) so a later approve/decline can
    chat.update this exact post instead of leaving a stale request up.
    """
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return None

    # Himesh's Slack user ID in Holbox Slack workspace
    himesh_slack_id = "U0BQ8HZ3MKJ"
    himesh_mention = f"<@{himesh_slack_id}>"

    dept_str = department.strip() if department else "General"
    desig_str = designation.strip() if designation else "Team Member"
    phone_str = phone.strip() if phone else "Not provided"

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "✨ New Employee Registration Request",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*{full_name}* has submitted a registration request to join Holbox AI.\n\n"
                    f"🏷️ *Status Mark:* `WANTS TO JOIN` (Candidate Signup)\n"
                    f"👤 *Applicant Name:* *{full_name}*\n"
                    f"📧 *Work Email:* `{email}`\n"
                    f"📞 *Phone:* `{phone_str}`\n"
                    f"🏢 *Department:* *{dept_str}*\n"
                    f"💼 *Desired Role:* *{desig_str}*\n\n"
                    f"👉 {himesh_mention} *You have to approve this employee through your dashboard.*"
                ),
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "Review & Approve in Dashboard",
                        "emoji": True,
                    },
                    "url": "https://attendance.holbox.ai/people",
                    "style": "primary",
                },
                *(
                    [{
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Decline request",
                            "emoji": True,
                        },
                        "style": "danger",
                        "action_id": "decline_signup",
                        "value": f"decline_signup:{signup_id}",
                        "confirm": {
                            "title": {"type": "plain_text", "text": "Decline registration?"},
                            "text": {
                                "type": "mrkdwn",
                                "text": f"Decline *{full_name}* (`{email}`)? They will not be added.",
                            },
                            "confirm": {"type": "plain_text", "text": "Decline"},
                            "deny": {"type": "plain_text", "text": "Cancel"},
                        },
                    }] if signup_id else []
                ),
            ],
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "Holbox HRMS Portal • Review candidate under People Directory or Notifications",
                }
            ],
        },
    ]

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"✨ New Employee Registration: {full_name} ({email}) wants to join. {himesh_mention} you have to approve him through your dashboard.",
                "blocks": blocks,
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error in post_signup_request_alert: {res_data.get('error')}")
            return None
        ts, channel = res_data.get("ts"), res_data.get("channel")
        if ts and channel:
            return ts, channel
        return None
    except Exception as e:
        logger.error(f"Failed to post signup request alert to Slack: {e}")
        return None


def post_signup_approved_alert(
    *,
    full_name: str,
    email: str,
    emp_code: str,
    admin_name: str,
    department: str | None = None,
    designation: str | None = None,
) -> None:
    """Tell the admin channel a signup was approved from the dashboard."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    dept_str = department.strip() if department else "General"
    desig_str = designation.strip() if designation else "Team Member"

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "✅ Employee Approved",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*{full_name}* has been approved and added to the workforce.\n\n"
                    f"🏷️ *Status:* `APPROVED`\n"
                    f"👤 *Employee:* *{full_name}* (`{emp_code}`)\n"
                    f"📧 *Work Email:* `{email}`\n"
                    f"🏢 *Department:* *{dept_str}*\n"
                    f"💼 *Role:* *{desig_str}*\n\n"
                    f"✅ *Approved by admin* — *{admin_name}*"
                ),
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "Holbox HRMS Portal • Approved from the dashboard",
                }
            ],
        },
    ]

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": (
                    f"✅ {full_name} ({emp_code}) got approved by admin {admin_name}."
                ),
                "blocks": blocks,
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(
                "Slack API error in post_signup_approved_alert: %s",
                res_data.get("error"),
            )
    except Exception as e:
        logger.error("Failed to post signup approved alert to Slack: %s", e)


def _find_signup_message_ts(email: str) -> tuple[str, str] | None:
    """Best-effort lookup of the original signup post when we did not store ts."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return None
    try:
        response = httpx.get(
            "https://slack.com/api/conversations.history",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            params={"channel": settings.slack_channel_id, "limit": 40},
            timeout=5.0,
        )
        data = response.json()
        if not data.get("ok"):
            logger.error("Slack history lookup failed: %s", data.get("error"))
            return None
        needle = email.lower()
        for msg in data.get("messages") or []:
            blob = f"{msg.get('text') or ''} {msg.get('blocks') or ''}".lower()
            if needle in blob and "registration" in blob:
                ts = msg.get("ts")
                if ts:
                    return ts, settings.slack_channel_id
    except Exception as e:
        logger.error("Failed to look up signup Slack message: %s", e)
    return None


def update_signup_decision(
    *,
    full_name: str,
    email: str,
    admin_name: str,
    approved: bool,
    emp_code: str | None = None,
    message_ts: str | None = None,
    channel_id: str | None = None,
    reason: str | None = None,
) -> bool:
    """Replace the original signup Slack post with the decision. No leftover buttons."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return False

    ts = message_ts
    channel = channel_id or settings.slack_channel_id
    if not ts:
        found = _find_signup_message_ts(email)
        if found:
            ts, channel = found
    if not ts:
        if approved:
            return False
        try:
            httpx.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
                json={
                    "channel": settings.slack_channel_id,
                    "text": f"❌ {full_name} ({email}) was declined by {admin_name}.",
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": (
                                    f"❌ *Registration declined*\n"
                                    f"*{full_name}* (`{email}`) was declined by *{admin_name}*."
                                    + (f"\n_{reason}_" if reason else "")
                                ),
                            },
                        }
                    ],
                },
                timeout=5.0,
            )
        except Exception as e:
            logger.error("Failed to post signup declined alert: %s", e)
        return False

    if approved:
        status = (
            f"✅ *Approved by {admin_name}*"
            + (f" — employee `{emp_code}`" if emp_code else "")
        )
        fallback = f"✅ {full_name} approved by {admin_name}"
    else:
        status = f"❌ *Declined by {admin_name}*"
        if reason:
            status += f"\n_{reason}_"
        fallback = f"❌ {full_name} declined by {admin_name}"

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "Employee Approved" if approved else "Registration Declined",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*{full_name}* (`{email}`)\n\n{status}\n\n"
                    f"_Holbox HRMS • decided from the dashboard or Slack_"
                ),
            },
        },
    ]

    try:
        response = httpx.post(
            "https://slack.com/api/chat.update",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": channel,
                "ts": ts,
                "text": fallback,
                "blocks": blocks,
            },
            timeout=5.0,
        )
        data = response.json()
        if not data.get("ok"):
            logger.error("Slack chat.update failed for signup: %s", data.get("error"))
            return False
        return True
    except Exception as e:
        logger.error("Failed to update signup Slack message: %s", e)
        return False

