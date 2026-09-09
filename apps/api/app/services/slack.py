import hashlib
import hmac
import logging
import time
from datetime import date
from urllib.parse import urlencode

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


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
) -> tuple[str, str] | None:
    """Post an interactive leave request message to Slack. Returns (ts, channel_id)."""
    if not settings.slack_bot_token or not settings.slack_channel_id:
        logger.info("Slack bot not configured. Skipping leave request notification.")
        return

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"🌴 *Leave Request: {employee_name}*\nRequested *{days:g} days* of {leave_type} from {from_date} to {to_date}.\n> \"{reason}\""
            }
        },
        {
            "type": "actions",
            "elements": [
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
                },
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "Reject",
                        "emoji": True
                    },
                    "style": "danger",
                    "value": f"reject:{leave_request_id}",
                    "action_id": "reject_leave"
                }
            ]
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
            
        return res_data.get("ts"), res_data.get("channel")
    except Exception as e:
        logger.error(f"Failed to post leave request to Slack: {e}")
        return None


def update_leave_request(
    channel_id: str,
    message_ts: str,
    original_text: str,
    approved: bool,
    actor_name: str,
) -> None:
    """Update a leave request message to remove buttons after it is decided."""
    if not settings.slack_bot_token:
        return

    # Extract the employee name and details from the original text block
    # Assuming original_text has the markdown we sent in post_leave_request
    
    status_text = f"✅ Approved by @{actor_name}" if approved else f"❌ Rejected by @{actor_name}"
    
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
