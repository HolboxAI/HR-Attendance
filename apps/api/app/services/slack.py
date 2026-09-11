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
        f"> \"{reason}\""
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

def post_late_arrival_alert(employee_name: str, arrive_time: str, late_minutes: int, shift_date: str) -> None:
    """Post a late arrival alert to Slack."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"⏳ *Late Arrival:* {employee_name} arrived late at {arrive_time} ({late_minutes} minutes late) for their shift on {shift_date}.",
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post late arrival alert to Slack: {e}")


def post_early_leave_alert(employee_name: str, leave_time: str, early_minutes: int, shift_date: str) -> None:
    """Post an early leave alert to Slack."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"🏃 *Early Leave:* {employee_name} left early at {leave_time} ({early_minutes} minutes early) for their shift on {shift_date}.",
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post early leave alert to Slack: {e}")


def post_signup_request_alert(
    full_name: str,
    email: str,
    phone: str | None = None,
    department: str | None = None,
) -> None:
    """Post an alert when a candidate submits an employee signup request."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return

    contact_bits = [f"📧 `{email}`"]
    if phone:
        contact_bits.append(f"📞 `{phone}`")
    if department:
        contact_bits.append(f"🏢 Dept: *{department}*")
    info_line = " | ".join(contact_bits)

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"✨ *New Employee Registration Request*\n*{full_name}* has requested to join Holbox AI.\n{info_line}\n\n_Review and approve in the Workforce Directory (`/people`) or Notifications._"
            }
        }
    ]

    try:
        response = httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={
                "channel": settings.slack_channel_id,
                "text": f"New Employee Signup: {full_name} ({email})",
                "blocks": blocks,
            },
            timeout=5.0,
        )
        res_data = response.json()
        if not res_data.get("ok"):
            logger.error(f"Slack API error in post_signup_request_alert: {res_data.get('error')}")
    except Exception as e:
        logger.error(f"Failed to post signup request alert to Slack: {e}")
