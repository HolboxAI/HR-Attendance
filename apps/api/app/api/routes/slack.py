import json
import logging
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.config import settings
from app.models.employee import Employee, User, UserRole
from app.models.leave import LeaveRequest
from app.services.leave import decide as leave_decide
from app.services.slack import post_reply, update_leave_request, verify_slack_signature

router = APIRouter(prefix="/slack", tags=["slack"])
logger = logging.getLogger(__name__)


@router.post("/interactions")
async def slack_interactions(
    request: Request,
    payload: Annotated[str, Form()],
    db: Session = Depends(get_db),
):
    """Handle interactive button clicks from Slack."""
    # 1. Verify the request came from Slack
    if settings.slack_signing_secret:
        body = await request.body()
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        
        if not verify_slack_signature(signature, timestamp, body, settings.slack_signing_secret):
            raise HTTPException(status_code=403, detail="Invalid Slack signature")

    # 2. Parse the payload
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if data.get("type") != "block_actions":
        return {"message": "Ignored"}

    action = data.get("actions", [{}])[0]
    action_value = action.get("value", "")
    
    if not action_value.startswith("approve:") and not action_value.startswith("reject:"):
        return {"message": "Ignored unknown action"}

    action_type, request_id_str = action_value.split(":", 1)
    approve = (action_type == "approve")

    slack_user = data.get("user", {}).get("username", "Unknown User")
    channel_id = data.get("channel", {}).get("id")
    message_ts = data.get("message", {}).get("ts")
    original_text = data.get("message", {}).get("blocks", [{}])[0].get("text", {}).get("text", "Leave Request")

    if settings.slack_channel_id and channel_id != settings.slack_channel_id:
        return {"message": "Interactions only permitted from the designated admin channel."}

    try:
        leave_request_id = uuid.UUID(request_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid leave request ID")

    # 3. Process the approval/rejection
    leave_req = db.get(LeaveRequest, leave_request_id)
    if not leave_req:
        return {"message": "Leave request not found"}

    # Find an admin to act as the approver (since this is an admin channel)
    hr_admin = db.scalar(
        select(User).where(User.role == UserRole.HR_ADMIN, User.is_active.is_(True)).limit(1)
    )
    if not hr_admin:
        # Fallback to ANY user if no HR admin exists
        hr_admin = db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
        
    if not hr_admin:
        logger.error("No valid approver found to process Slack approval")
        return {"message": "Internal error: No valid approver found"}

    outcome = leave_decide(
        db,
        request=leave_req,
        approver=hr_admin,
        approve=approve,
        note=f"Decided via Slack by @{slack_user}",
        allow_self_approval=True  # Bypasses the self-approval block for Slack bots
    )

    if not outcome.ok:
        logger.warning(f"Slack approval failed: {outcome.reason}")
        # Could post an ephemeral error back to the user here
        return {"message": outcome.reason}

    db.commit()

    # 4. Update the Slack message to remove buttons
    if channel_id and message_ts:
        update_leave_request(
            channel_id=channel_id,
            message_ts=message_ts,
            original_text=original_text,
            approved=approve,
            actor_name=slack_user,
        )

    return {"message": "Success"}

@router.post("/events")
async def slack_events(request: Request):
    """Handle Slack Events API (e.g. app_mention, url_verification)."""
    body = await request.body()
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # 1. Handle Slack URL Verification handshake
    if data.get("type") == "url_verification":
        return {"challenge": data.get("challenge")}

    # 2. Verify Signature for actual events
    if settings.slack_signing_secret:
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        if not verify_slack_signature(signature, timestamp, body, settings.slack_signing_secret):
            raise HTTPException(status_code=403, detail="Invalid Slack signature")

    # 3. Handle specific events
    if data.get("type") == "event_callback":
        event = data.get("event", {})
        
        channel_id = event.get("channel")
        if event.get("type") == "app_mention":
            thread_ts = event.get("thread_ts") or event.get("ts")
            from threading import Thread
            
            if settings.slack_channel_id and channel_id != settings.slack_channel_id:
                msg = "Hi! 👋 I only process attendance alerts and leave approvals in the designated admin channel."
            else:
                msg = (
                    "Hello! 👋 I'm your Boxcode HRMS bot. I automatically post leave requests here for approval, "
                    "and I'll alert you if anyone misses their check-in."
                )
                
            # Fire the reply asynchronously
            Thread(target=post_reply, args=(channel_id, msg, thread_ts), daemon=True).start()

    return {"message": "Success"}
