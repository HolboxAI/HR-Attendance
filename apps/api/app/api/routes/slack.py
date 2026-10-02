import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import org_today
from app.core.config import settings
from app.core.security import generate_action_token
from app.db.session import get_db
from app.models.employee import Employee, User, UserRole
from app.models.enums import CorrectionStatus, LeaveStatus
from app.models.late_request import LateRequest
from app.models.leave import LeaveRequest
from app.models.wfh_request import WFHRequest
from app.services.leave import decide as leave_decide
from app.services.slack import (
    _get_all_slack_members,
    open_slack_modal,
    post_ephemeral_to_admins,
    post_ephemeral_to_user,
    post_late_approved_broadcast,
    post_reply,
    update_leave_request,
    verify_slack_signature,
)

router = APIRouter(prefix="/slack", tags=["slack"])
logger = logging.getLogger(__name__)


def _find_employee_by_slack(db: Session, slack_user_id: str, username: str | None = None) -> Employee | None:
    """Find matching employee by slack member profile email or matching name."""
    members = _get_all_slack_members()
    slack_email = None
    for m in members:
        if m.get("id") == slack_user_id:
            slack_email = m.get("profile", {}).get("email")
            break

    if slack_email:
        emp = db.scalar(
            select(Employee).where(
                Employee.email == slack_email.strip().lower(),
                Employee.is_active.is_(True),
            )
        )
        if emp:
            return emp

    if username:
        u = username.strip().lower()
        # Direct email prefix match (e.g. krish -> krish@holbox.ai)
        emp = db.scalar(
            select(Employee).where(
                Employee.email.ilike(f"{u}@%"),
                Employee.is_active.is_(True),
            )
        )
        if emp:
            return emp

        # Name match
        emp = db.scalar(
            select(Employee).where(
                Employee.full_name.ilike(f"%{u}%"),
                Employee.is_active.is_(True),
            )
        )
        if emp:
            return emp

    return None


@router.post("/commands")
async def slack_commands(
    request: Request,
    db: Session = Depends(get_db),
):
    """Handle all Slack Slash commands (/checkin, /checkout, /break, /resume, /late, /early-checkout, /leave, /wfh)."""
    body = await request.body()

    if settings.slack_signing_secret:
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        if not verify_slack_signature(signature, timestamp, body, settings.slack_signing_secret):
            raise HTTPException(status_code=403, detail="Invalid Slack signature")

    form_data = parse_qs(body.decode("utf-8"))
    command = form_data.get("command", [""])[0].strip()
    trigger_id = form_data.get("trigger_id", [""])[0].strip()
    user_id = form_data.get("user_id", [""])[0].strip()
    user_name = form_data.get("user_name", [""])[0].strip()
    channel_id = form_data.get("channel_id", [""])[0].strip()
    text = form_data.get("text", [""])[0].strip()

    emp = _find_employee_by_slack(db, user_id, user_name)

    # 1. /checkin, /checkout, /break, /resume -> Option A 1-Click Biometric Punch Link
    if command in ("/checkin", "/checkout", "/break", "/resume"):
        punch_type_map = {
            "/checkin": "check_in",
            "/checkout": "check_out",
            "/break": "break_out",
            "/resume": "break_in",
        }
        label_map = {
            "/checkin": "Check-In",
            "/checkout": "Check-Out",
            "/break": "Start Break",
            "/resume": "End Break & Resume",
        }
        action_type = punch_type_map[command]
        action_label = label_map[command]

        if not emp:
            return {
                "response_type": "ephemeral",
                "text": f"⚠️ Could not link your Slack account (`{user_name}`) to an employee profile. Please contact HR.",
            }

        # Generate a signed 5-minute single-use punch action token
        sub_str = str(emp.id)
        token = generate_action_token(
            action=f"punch_{action_type}",
            sub=sub_str,
            payload={
                "emp_code": emp.emp_code,
                "punch_type": action_type,
                "slack_user_id": user_id,
            },
            expires_hours=1,  # Short-lived
        )

        # Base URL from api_url or default web url
        base_web_url = settings.api_url.replace("/api/v1", "").rstrip("/")
        if "attendance.holbox.ai" in base_web_url or not base_web_url:
            base_web_url = "https://attendance.holbox.ai"

        punch_url = f"{base_web_url}/punch?token={token}&action={action_type}"

        return {
            "response_type": "ephemeral",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"👋 Hey *{emp.full_name}*, tap below to verify your face and record your *{action_label}*:",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": f"⚡ Tap to {action_label}",
                                "emoji": True,
                            },
                            "url": punch_url,
                            "style": "primary" if "in" in action_type else "danger",
                        }
                    ],
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": "🔒 _Opens camera directly for 1-second biometric & GPS check. Valid for 5 minutes._",
                        }
                    ],
                },
            ],
        }

    # 2. /late -> Private modal to enter reason
    if command == "/late":
        view = {
            "type": "modal",
            "callback_id": "submit_late_request",
            "title": {"type": "plain_text", "text": "Late Arrival Request"},
            "submit": {"type": "plain_text", "text": "Submit"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "private_metadata": json.dumps({"channel_id": channel_id, "user_id": user_id}),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "Please provide the reason for your late arrival today. This reason will be delivered privately to admins for approval.",
                    },
                },
                {
                    "type": "input",
                    "block_id": "late_reason_block",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "late_reason_input",
                        "multiline": True,
                        "placeholder": {"type": "plain_text", "text": "e.g. Doctor appointment, severe traffic..."},
                        "initial_value": text if text else "",
                    },
                    "label": {"type": "plain_text", "text": "Reason for Late Arrival"},
                },
            ],
        }
        open_slack_modal(trigger_id, view)
        return Response(status_code=200)

    # 3. /early-checkout & /early-leave -> Private modal
    if command in ("/early-checkout", "/early-leave", "/earlyleave"):
        view = {
            "type": "modal",
            "callback_id": "submit_early_checkout_request",
            "title": {"type": "plain_text", "text": "Early Checkout Request"},
            "submit": {"type": "plain_text", "text": "Submit"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "private_metadata": json.dumps({"channel_id": channel_id, "user_id": user_id}),
            "blocks": [
                {
                    "type": "input",
                    "block_id": "early_reason_block",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "early_reason_input",
                        "multiline": True,
                        "placeholder": {"type": "plain_text", "text": "State your reason for early departure..."},
                        "initial_value": text if text else "",
                    },
                    "label": {"type": "plain_text", "text": "Reason for Early Checkout"},
                },
            ],
        }
        open_slack_modal(trigger_id, view)
        return Response(status_code=200)

    # 4. /wfh & /apply-wfh -> Private modal for WFH request
    if command in ("/wfh", "/apply-wfh", "/request-wfh"):
        today_str = org_today().isoformat()
        view = {
            "type": "modal",
            "callback_id": "submit_wfh_request",
            "title": {"type": "plain_text", "text": "Work From Home Request"},
            "submit": {"type": "plain_text", "text": "Submit"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "private_metadata": json.dumps({"channel_id": channel_id, "user_id": user_id}),
            "blocks": [
                {
                    "type": "input",
                    "block_id": "wfh_date_block",
                    "element": {
                        "type": "datepicker",
                        "action_id": "wfh_date_input",
                        "initial_date": today_str,
                        "placeholder": {"type": "plain_text", "text": "Select date"},
                    },
                    "label": {"type": "plain_text", "text": "Date"},
                },
                {
                    "type": "input",
                    "block_id": "wfh_reason_block",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "wfh_reason_input",
                        "multiline": True,
                        "placeholder": {"type": "plain_text", "text": "Reason for WFH..."},
                        "initial_value": text if text else "",
                    },
                    "label": {"type": "plain_text", "text": "Reason"},
                },
            ],
        }
        open_slack_modal(trigger_id, view)
        return Response(status_code=200)

    # 5. /apply-leave, /request-leave, /leave -> Private modal
    if command in ("/leave", "/apply-leave", "/request-leave", "/timeoff"):
        today_str = org_today().isoformat()
        view = {
            "type": "modal",
            "callback_id": "submit_leave_request",
            "title": {"type": "plain_text", "text": "Apply for Leave"},
            "submit": {"type": "plain_text", "text": "Submit"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "private_metadata": json.dumps({"channel_id": channel_id, "user_id": user_id}),
            "blocks": [
                {
                    "type": "input",
                    "block_id": "leave_from_block",
                    "element": {
                        "type": "datepicker",
                        "action_id": "leave_from_input",
                        "initial_date": today_str,
                    },
                    "label": {"type": "plain_text", "text": "From Date"},
                },
                {
                    "type": "input",
                    "block_id": "leave_to_block",
                    "element": {
                        "type": "datepicker",
                        "action_id": "leave_to_input",
                        "initial_date": today_str,
                    },
                    "label": {"type": "plain_text", "text": "To Date"},
                },
                {
                    "type": "input",
                    "block_id": "leave_reason_block",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "leave_reason_input",
                        "multiline": True,
                        "placeholder": {"type": "plain_text", "text": "State reason for leave..."},
                        "initial_value": text if text else "",
                    },
                    "label": {"type": "plain_text", "text": "Reason"},
                },
            ],
        }
        open_slack_modal(trigger_id, view)
        return Response(status_code=200)

    return {"response_type": "ephemeral", "text": f"Unknown command {command}"}


@router.post("/interactions")
async def slack_interactions(
    request: Request,
    db: Session = Depends(get_db),
):
    """Handle interactive button clicks and modal submissions from Slack."""
    body = await request.body()

    if settings.slack_signing_secret:
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        if not verify_slack_signature(signature, timestamp, body, settings.slack_signing_secret):
            raise HTTPException(status_code=403, detail="Invalid Slack signature")

    payload_str = ""
    try:
        parsed = parse_qs(body.decode("utf-8"))
        if "payload" in parsed and parsed["payload"]:
            payload_str = parsed["payload"][0]
    except Exception:
        pass

    if not payload_str:
        try:
            form = await request.form()
            payload_str = str(form.get("payload", ""))
        except Exception:
            pass

    try:
        data = json.loads(payload_str)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    payload_type = data.get("type")

    # A. View Submissions (Modals for /late, /wfh, /leave)
    if payload_type == "view_submission":
        callback_id = data.get("view", {}).get("callback_id")
        user = data.get("user", {})
        slack_user_id = user.get("id")
        slack_user_name = user.get("name") or user.get("username", "Employee")
        values = data.get("view", {}).get("state", {}).get("values", {})
        meta_str = data.get("view", {}).get("private_metadata", "{}")
        try:
            meta = json.loads(meta_str)
        except Exception:
            meta = {}
        channel_id = meta.get("channel_id") or settings.slack_channel_id

        emp = _find_employee_by_slack(db, slack_user_id, slack_user_name)
        if not emp:
            return {"response_action": "errors", "errors": {"late_reason_block": "Could not map your Slack user to an employee profile."}}

        if callback_id == "submit_late_request":
            reason = values.get("late_reason_block", {}).get("late_reason_input", {}).get("value", "").strip()
            today_date = org_today()

            # Create or update LateRequest
            late_req = LateRequest(
                id=uuid.uuid4(),
                org_id=emp.org_id,
                employee_id=emp.id,
                shift_date=today_date,
                reason=reason,
                status=CorrectionStatus.PENDING,
            )
            db.add(late_req)
            db.commit()

            # Ephemeral approval card sent ONLY to admins in the channel
            admin_blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🕒 Late Arrival Request (Private to Admins)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp.full_name}* (`{emp.emp_code}`) has requested late arrival approval for today ({today_date.strftime('%d %b %Y')}).\n\n📝 *Reason:* _{reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve Late Arrival", "emoji": True},
                            "style": "primary",
                            "value": f"approve_late:{late_req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject_late:{late_req.id}",
                        },
                    ],
                },
            ]

            if channel_id:
                post_ephemeral_to_admins(
                    channel_id=channel_id,
                    text=f"Late arrival request from {emp.full_name}",
                    blocks=admin_blocks,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text="✅ Your late arrival reason was submitted privately to admins for approval.",
                )

            return {"response_action": "clear"}

        if callback_id == "submit_wfh_request":
            wfh_date_str = values.get("wfh_date_block", {}).get("wfh_date_input", {}).get("selected_date")
            reason = values.get("wfh_reason_block", {}).get("wfh_reason_input", {}).get("value", "").strip()
            target_date = datetime.strptime(wfh_date_str, "%Y-%m-%d").date() if wfh_date_str else org_today()

            wfh_req = WFHRequest(
                id=uuid.uuid4(),
                org_id=emp.org_id,
                employee_id=emp.id,
                shift_date=target_date,
                reason=reason,
                status=CorrectionStatus.PENDING,
            )
            db.add(wfh_req)
            db.commit()

            admin_blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🏠 WFH Request (Private to Admins)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp.full_name}* requested Work From Home on *{target_date.strftime('%d %b %Y')}*.\n📝 *Reason:* _{reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve WFH", "emoji": True},
                            "style": "primary",
                            "value": f"approve_wfh:{wfh_req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject_wfh:{wfh_req.id}",
                        },
                    ],
                },
            ]
            if channel_id:
                post_ephemeral_to_admins(
                    channel_id=channel_id,
                    text=f"WFH request from {emp.full_name}",
                    blocks=admin_blocks,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text="✅ Your WFH request was submitted privately to admins for approval.",
                )
            return {"response_action": "clear"}

        if callback_id == "submit_leave_request":
            from_str = values.get("leave_from_block", {}).get("leave_from_input", {}).get("selected_date")
            to_str = values.get("leave_to_block", {}).get("leave_to_input", {}).get("selected_date")
            reason = values.get("leave_reason_block", {}).get("leave_reason_input", {}).get("value", "").strip()

            from_date = datetime.strptime(from_str, "%Y-%m-%d").date() if from_str else org_today()
            to_date = datetime.strptime(to_str, "%Y-%m-%d").date() if to_str else from_date
            if to_date < from_date:
                to_date = from_date

            days_count = float((to_date - from_date).days + 1)

            # Look up default leave type for org
            from app.models.leave import LeaveType
            lt = db.scalar(select(LeaveType).where(LeaveType.org_id == emp.org_id).limit(1))

            leave_req = LeaveRequest(
                id=uuid.uuid4(),
                org_id=emp.org_id,
                employee_id=emp.id,
                leave_type_id=lt.id if lt else emp.org_id,
                from_date=from_date,
                to_date=to_date,
                days=days_count,
                reason=reason,
                status=LeaveStatus.PENDING,
            )
            db.add(leave_req)
            db.commit()

            admin_blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🌴 Leave Request (Private to Admins)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp.full_name}* requested *{days_count:g} days* of leave from *{from_date.strftime('%d %b %Y')}* to *{to_date.strftime('%d %b %Y')}*.\n📝 *Reason:* _{reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve Leave", "emoji": True},
                            "style": "primary",
                            "value": f"approve:{leave_req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject:{leave_req.id}",
                        },
                    ],
                },
            ]
            if channel_id:
                post_ephemeral_to_admins(
                    channel_id=channel_id,
                    text=f"Leave request from {emp.full_name}",
                    blocks=admin_blocks,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text=f"✅ Your leave request ({from_date} to {to_date}) was submitted privately to admins for approval.",
                )
            return {"response_action": "clear"}

        return {"response_action": "clear"}

    # B. Block Actions (Button Clicks)
    if payload_type != "block_actions":
        return {"message": "Ignored"}

    action = data.get("actions", [{}])[0]
    action_value = action.get("value", "")
    slack_user = data.get("user", {}).get("username") or data.get("user", {}).get("name", "admin")
    slack_user_id = data.get("user", {}).get("id")
    channel_id = data.get("channel", {}).get("id")
    message_ts = data.get("message", {}).get("ts")
    response_url = data.get("response_url")

    # 1. Late Approval / Rejection
    if action_value.startswith("approve_late:") or action_value.startswith("reject_late:"):
        is_approve = action_value.startswith("approve_late:")
        late_id_str = action_value.split(":", 1)[1]
        try:
            late_id = uuid.UUID(late_id_str)
        except ValueError:
            return {"message": "Invalid late request ID"}

        late_req = db.get(LateRequest, late_id)
        if not late_req:
            return {"message": "Late request not found"}

        req_emp = db.get(Employee, late_req.employee_id)

        hr_admin = db.scalar(
            select(User).where(
                User.role.in_([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]),
                User.is_active.is_(True),
            ).limit(1)
        )

        late_req.status = CorrectionStatus.APPROVED if is_approve else CorrectionStatus.REJECTED
        late_req.decided_by_id = hr_admin.id if hr_admin else None
        late_req.decided_by_slack_id = slack_user_id
        late_req.decided_by_name = slack_user
        late_req.decided_at = datetime.now(timezone.utc)
        late_req.decided_note = f"Decided via Slack by @{slack_user}"

        db.commit()

        # Recompute attendance day so employee is immediately marked PRESENT
        if req_emp and is_approve:
            from app.services.attendance import recompute_day
            recompute_day(db, req_emp, late_req.shift_date)
            db.commit()

            # Broadcast public late approval with warning message tagged to employee
            post_late_approved_broadcast(
                employee_name=req_emp.full_name,
                employee_email=req_emp.email,
                admin_name=slack_user,
                channel_id=channel_id,
            )

        # Notify the admin who clicked
        import httpx
        if response_url:
            status_text = f"✅ Late arrival approved for {req_emp.full_name if req_emp else 'employee'}." if is_approve else f"❌ Late arrival rejected for {req_emp.full_name if req_emp else 'employee'}."
            try:
                httpx.post(
                    response_url,
                    json={"text": f"{status_text} (Recorded by @{slack_user})", "replace_original": True},
                    timeout=5.0,
                )
            except Exception:
                pass

        return {"message": "Success"}

    # 2. WFH Approval / Rejection
    if action_value.startswith("approve_wfh:") or action_value.startswith("reject_wfh:"):
        is_approve = action_value.startswith("approve_wfh:")
        wfh_id_str = action_value.split(":", 1)[1]
        try:
            wfh_id = uuid.UUID(wfh_id_str)
        except ValueError:
            return {"message": "Invalid WFH request ID"}

        wfh_req = db.get(WFHRequest, wfh_id)
        if not wfh_req:
            return {"message": "WFH request not found"}

        req_emp = db.get(Employee, wfh_req.employee_id)
        wfh_req.status = CorrectionStatus.APPROVED if is_approve else CorrectionStatus.REJECTED
        wfh_req.decided_at = datetime.now(timezone.utc)
        wfh_req.decided_note = f"Decided via Slack by @{slack_user}"
        db.commit()

        if req_emp and is_approve:
            from app.services.attendance import recompute_day
            recompute_day(db, req_emp, wfh_req.shift_date)
            db.commit()

        import httpx
        if response_url:
            status_text = f"✅ WFH approved for {req_emp.full_name if req_emp else 'employee'} on {wfh_req.shift_date}." if is_approve else f"❌ WFH rejected for {req_emp.full_name if req_emp else 'employee'}."
            try:
                httpx.post(
                    response_url,
                    json={"text": f"{status_text} (Recorded by @{slack_user})", "replace_original": True},
                    timeout=5.0,
                )
            except Exception:
                pass

        return {"message": "Success"}

    # 3. Existing Signup & Leave Actions
    if action_value.startswith("decline_signup:"):
        from app.api.routes.admin_signups import apply_decline
        from app.models.signup_request import SignupRequest

        signup_id_str = action_value.split(":", 1)[1]
        try:
            signup_uuid = uuid.UUID(signup_id_str)
        except ValueError:
            return {"message": "Invalid signup request"}
        req = db.get(SignupRequest, signup_uuid)
        if req is None:
            return {"message": "Signup request not found"}
        hr_admin = db.scalar(
            select(User).where(
                User.role.in_([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]),
                User.is_active.is_(True),
            ).limit(1)
        )
        if not hr_admin:
            hr_admin = db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
        if not hr_admin:
            return {"message": "No admin available to record the decline"}
        try:
            apply_decline(
                db,
                req=req,
                actor=hr_admin,
                reason=f"Declined via Slack by @{slack_user}",
                slack_message_ts=message_ts,
                slack_channel_id=channel_id,
            )
        except HTTPException as exc:
            return {"message": str(exc.detail)}
        return {"message": "Success"}

    if action_value.startswith("partial_approve:"):
        action_type = "partial_approve"
        request_id_str = action_value.split(":", 1)[1]
        partial_approve = True
        approve = True
        decision_note = f"Partially approved via Slack by @{slack_user}. Please submit your medical certificate / doctor's prescription."
    elif action_value.startswith("approve:"):
        action_type = "approve"
        request_id_str = action_value.split(":", 1)[1]
        partial_approve = False
        approve = True
        decision_note = f"Decided via Slack by @{slack_user}"
    elif action_value.startswith("reject:"):
        action_type = "reject"
        request_id_str = action_value.split(":", 1)[1]
        partial_approve = False
        approve = False
        decision_note = f"Decided via Slack by @{slack_user}"
    else:
        return {"message": "Ignored unknown action"}

    original_text = data.get("message", {}).get("blocks", [{}])[0].get("text", {}).get("text", "Leave Request")

    try:
        leave_request_id = uuid.UUID(request_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid leave request ID")

    leave_req = db.get(LeaveRequest, leave_request_id)
    if not leave_req:
        return {"message": "Leave request not found"}

    hr_admin = db.scalar(
        select(User).where(User.role.in_([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]), User.is_active.is_(True)).limit(1)
    )
    if not hr_admin:
        hr_admin = db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
    if not hr_admin:
        return {"message": "Internal error: No valid approver found"}

    outcome = leave_decide(
        db,
        request=leave_req,
        approver=hr_admin,
        approve=approve,
        partial_approve=partial_approve,
        note=decision_note,
        allow_self_approval=True,
    )

    if not outcome.ok:
        return {"message": outcome.reason}

    db.commit()

    if channel_id and message_ts:
        update_leave_request(
            channel_id=channel_id,
            message_ts=message_ts,
            original_text=original_text,
            approved=approve,
            actor_name=slack_user,
            partial_approve=partial_approve,
            note="Please submit your medical certificate / doctor's prescription." if partial_approve else None,
        )

    return {"message": "Success"}


@router.post("/events")
async def slack_events(request: Request):
    """Handle Slack Events API."""
    body = await request.body()
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if data.get("type") == "url_verification":
        return {"challenge": data.get("challenge")}

    if settings.slack_signing_secret:
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        if not verify_slack_signature(signature, timestamp, body, settings.slack_signing_secret):
            raise HTTPException(status_code=403, detail="Invalid Slack signature")

    if data.get("type") == "event_callback":
        event = data.get("event", {})
        channel_id = event.get("channel")
        if event.get("type") == "app_mention":
            thread_ts = event.get("thread_ts") or event.get("ts")
            from threading import Thread
            msg = (
                "Hello! 👋 I'm your Holbox HRMS bot. Use slash commands like `/checkin`, `/checkout`, `/break`, `/resume`, `/late`, `/wfh`, or `/leave`."
            )
            Thread(target=post_reply, args=(channel_id, msg, thread_ts), daemon=True).start()

    return {"message": "Success"}
