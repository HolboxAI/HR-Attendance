import json
import logging
import uuid
from datetime import datetime, time, timedelta, timezone
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
from app.models.enums import CorrectionStatus, LeaveStatus, PunchDirection
from app.models.late_request import LateRequest
from app.models.leave import LeaveRequest
from app.models.wfh_request import WFHRequest
from app.services.leave import decide as leave_decide
from app.services.slack import (
    _get_all_slack_members,
    format_slack_mention,
    is_slack_admin,
    notify_admins_and_employee,
    open_slack_modal,
    post_ephemeral_to_admins,
    post_ephemeral_to_user,
    slack_user_id_for_email,
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


def _slack_approver_user(db: Session, slack_user_id: str, username: str | None) -> User | None:
    """Map the Slack clicker to their Holbox User row (must be HR/super admin)."""
    emp = _find_employee_by_slack(db, slack_user_id, username)
    if emp is None:
        return None
    user = db.scalar(
        select(User).where(
            User.employee_id == emp.id,
            User.is_active.is_(True),
            User.role.in_([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]),
        )
    )
    return user


def _refuse_non_admin(response_url: str | None, slack_user_id: str | None) -> dict | None:
    if is_slack_admin(slack_user_id):
        return None
    msg = "Only Holbox admins can approve or reject this request."
    if response_url:
        import httpx
        try:
            httpx.post(
                response_url,
                json={"text": f"⛔ {msg}", "replace_original": False},
                timeout=5.0,
            )
        except Exception:
            pass
    return {"message": msg}


def _refuse_self_decide(
    response_url: str | None,
    clicker_emp: Employee | None,
    request_employee_id,
) -> dict | None:
    if clicker_emp is None or clicker_emp.id != request_employee_id:
        return None
    msg = "You cannot approve or reject your own request. Another admin must decide."
    if response_url:
        import httpx
        try:
            httpx.post(
                response_url,
                json={"text": f"⛔ {msg}", "replace_original": False},
                timeout=5.0,
            )
        except Exception:
            pass
    return {"message": msg}


def _open_approve_reason_modal(
    *,
    trigger_id: str,
    kind: str,
    request_id: str,
    channel_id: str | None,
    message_ts: str | None,
    response_url: str | None,
) -> dict:
    """Approve always asks for a mandatory decision reason first."""
    view = {
        "type": "modal",
        "callback_id": "submit_admin_decision_reason",
        "title": {"type": "plain_text", "text": "Approval reason"},
        "submit": {"type": "plain_text", "text": "Approve"},
        "close": {"type": "plain_text", "text": "Cancel"},
        "private_metadata": json.dumps({
            "kind": kind,
            "request_id": request_id,
            "channel_id": channel_id,
            "message_ts": message_ts,
            "response_url": response_url,
        }),
        "blocks": [
            {
                "type": "input",
                "block_id": "decision_reason_block",
                "element": {
                    "type": "plain_text_input",
                    "action_id": "decision_reason_input",
                    "multiline": True,
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Why are you approving? (required)",
                    },
                },
                "label": {"type": "plain_text", "text": "Reason for approval"},
            },
        ],
    }
    ok = open_slack_modal(trigger_id, view)
    if not ok:
        return {"message": "Could not open approval reason form"}
    return {"message": "ok"}


APPLICANT_WAIT_TEXT = (
    "✅ Sent to Holbox admins for review. You will be notified privately when they respond. "
    "You cannot approve or reject your own request."
)


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

        if command == "/checkout" and emp is not None:
            from app.services.attendance import next_direction, policy_for
            from app.services.resolver import shift_date_for
            policy, _ = policy_for(db, emp, org_today())
            shift_date = shift_date_for(datetime.now(timezone.utc), policy)
            if next_direction(db, emp, shift_date) != PunchDirection.OUT:
                return {
                    "response_type": "ephemeral",
                    "text": (
                        "You are not checked in. A new day starts at 5:00 AM, "
                        "so yesterday's shift no longer needs a checkout. Use /checkin."
                    ),
                }

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
        if not emp:
            return {
                "response_type": "ephemeral",
                "text": f"⚠️ Could not map your Slack user (`{user_name}`) to an employee profile.",
            }

        # Check if employee has checked in today and if they are late
        from app.services.attendance import policy_for, recompute_day
        from app.models.attendance import AttendanceDay
        today_date = org_today()
        day_rec = db.scalar(
            select(AttendanceDay).where(
                AttendanceDay.employee_id == emp.id,
                AttendanceDay.shift_date == today_date,
            )
        )
        if not day_rec:
            day_rec = recompute_day(db, emp, today_date)

        if not day_rec or day_rec.first_in is None:
            return {
                "response_type": "ephemeral",
                "text": "⚠️ *Not Checked In*: You have not checked in today yet. Please check in first using `/checkin` before requesting late arrival approval.",
            }

        if (day_rec.late_minutes or 0) <= 0 and not day_rec.has_exception:
            return {
                "response_type": "ephemeral",
                "text": "🎉 *On Time*: You checked in on time for your scheduled shift today! No late arrival request is required.",
            }

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
                        "text": f"You were recorded *{day_rec.late_minutes}m late* today. Please state your reason for late arrival below for admin review.",
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

    # 6. /correction & /correct -> Private modal for Attendance Regularization / Missed Punch / Late Arrival
    if command in ("/correction", "/correct", "/regularize"):
        if not emp:
            return {
                "response_type": "ephemeral",
                "text": f"⚠️ Could not map your Slack user (`{user_name}`) to an employee profile.",
            }

        yesterday_str = (org_today() - timedelta(days=1)).isoformat()
        view = {
            "type": "modal",
            "callback_id": "submit_correction_request",
            "title": {"type": "plain_text", "text": "Attendance Correction"},
            "submit": {"type": "plain_text", "text": "Submit"},
            "close": {"type": "plain_text", "text": "Cancel"},
            "private_metadata": json.dumps({"channel_id": channel_id, "user_id": user_id}),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"👋 *{emp.full_name}*, submit a correction to regularize late arrival, missed check-in, or missed check-out. Admins will review your request.",
                    },
                },
                {
                    "type": "input",
                    "block_id": "correction_date_block",
                    "element": {
                        "type": "datepicker",
                        "action_id": "correction_date_input",
                        "initial_date": yesterday_str,
                        "placeholder": {"type": "plain_text", "text": "Select shift date"},
                    },
                    "label": {"type": "plain_text", "text": "Shift Date"},
                },
                {
                    "type": "input",
                    "block_id": "correction_category_block",
                    "element": {
                        "type": "static_select",
                        "action_id": "correction_category_input",
                        "placeholder": {"type": "plain_text", "text": "Select correction type"},
                        "initial_option": {
                            "text": {"type": "plain_text", "text": "Late Arrival / Shift Regularization"},
                            "value": "late_arrival",
                        },
                        "options": [
                            {
                                "text": {"type": "plain_text", "text": "Late Arrival / Shift Regularization"},
                                "value": "late_arrival",
                            },
                            {
                                "text": {"type": "plain_text", "text": "Missed Check-In"},
                                "value": "missed_check_in",
                            },
                            {
                                "text": {"type": "plain_text", "text": "Missed Check-Out"},
                                "value": "missed_check_out",
                            },
                            {
                                "text": {"type": "plain_text", "text": "Biometric / Device Glitch"},
                                "value": "device_glitch",
                            },
                            {
                                "text": {"type": "plain_text", "text": "Other"},
                                "value": "other",
                            },
                        ],
                    },
                    "label": {"type": "plain_text", "text": "Reason Category"},
                },
                {
                    "type": "input",
                    "block_id": "correction_dir_block",
                    "element": {
                        "type": "static_select",
                        "action_id": "correction_dir_input",
                        "placeholder": {"type": "plain_text", "text": "Select punch direction"},
                        "initial_option": {
                            "text": {"type": "plain_text", "text": "Check-In (IN)"},
                            "value": "in",
                        },
                        "options": [
                            {
                                "text": {"type": "plain_text", "text": "Check-In (IN)"},
                                "value": "in",
                            },
                            {
                                "text": {"type": "plain_text", "text": "Check-Out (OUT)"},
                                "value": "out",
                            },
                        ],
                    },
                    "label": {"type": "plain_text", "text": "Punch Direction"},
                },
                {
                    "type": "input",
                    "block_id": "correction_time_block",
                    "element": {
                        "type": "timepicker",
                        "action_id": "correction_time_input",
                        "initial_time": "18:00",
                        "placeholder": {"type": "plain_text", "text": "Select actual punch time"},
                    },
                    "label": {"type": "plain_text", "text": "Actual Punch Time (IST)"},
                },
                {
                    "type": "input",
                    "block_id": "correction_reason_block",
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "correction_reason_input",
                        "multiline": True,
                        "placeholder": {"type": "plain_text", "text": "Explain reason (e.g. Traffic delay, forgot to punch, system error)..."},
                        "initial_value": text if text else "",
                    },
                    "label": {"type": "plain_text", "text": "Detailed Reason"},
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

        if callback_id == "submit_admin_decision_reason":
            reason = values.get("decision_reason_block", {}).get("decision_reason_input", {}).get("value", "").strip()
            if not reason:
                return {
                    "response_action": "errors",
                    "errors": {"decision_reason_block": "An approval reason is required."},
                }
            kind = meta.get("kind") or ""
            request_id = meta.get("request_id") or ""
            channel_id = meta.get("channel_id") or settings.slack_channel_id
            message_ts = meta.get("message_ts")
            response_url = meta.get("response_url")
            result = _apply_admin_decision(
                db,
                kind=kind,
                request_id=request_id,
                approve=True,
                decision_reason=reason,
                slack_user_id=slack_user_id,
                slack_user=slack_user_name,
                channel_id=channel_id,
                message_ts=message_ts,
                response_url=response_url,
                partial_approve=(kind == "partial_approve"),
            )
            if result.get("error"):
                return {
                    "response_action": "errors",
                    "errors": {"decision_reason_block": result["error"]},
                }
            return {"response_action": "clear"}

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
                    exclude_user_ids=[slack_user_id] if slack_user_id else None,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text=APPLICANT_WAIT_TEXT,
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
                    exclude_user_ids=[slack_user_id] if slack_user_id else None,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text=APPLICANT_WAIT_TEXT,
                )
            return {"response_action": "clear"}

        if callback_id == "submit_early_checkout_request":
            reason = values.get("early_reason_block", {}).get("early_reason_input", {}).get("value", "").strip()
            if not reason:
                return {
                    "response_action": "errors",
                    "errors": {"early_reason_block": "Reason is required."},
                }
            today_date = org_today()
            # Reuse late_requests row with a clear prefix — same admin decide path.
            early_req = LateRequest(
                id=uuid.uuid4(),
                org_id=emp.org_id,
                employee_id=emp.id,
                shift_date=today_date,
                reason=f"[Early checkout] {reason}",
                status=CorrectionStatus.PENDING,
            )
            db.add(early_req)
            db.commit()
            admin_blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🏃 Early Checkout Request (Private to Admins)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            f"*{emp.full_name}* (`{emp.emp_code}`) requested early checkout for "
                            f"*{today_date.strftime('%d %b %Y')}*.\n📝 *Reason:* _{reason}_"
                        ),
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve Early Checkout", "emoji": True},
                            "style": "primary",
                            "value": f"approve_early:{early_req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject_early:{early_req.id}",
                        },
                    ],
                },
            ]
            if channel_id:
                post_ephemeral_to_admins(
                    channel_id=channel_id,
                    text=f"Early checkout request from {emp.full_name}",
                    blocks=admin_blocks,
                    exclude_user_ids=[slack_user_id] if slack_user_id else None,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text=APPLICANT_WAIT_TEXT,
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

            # Look up default leave type for org
            from app.models.leave import LeaveType
            from app.services import leave as leave_service
            lt = db.scalar(select(LeaveType).where(LeaveType.org_id == emp.org_id, LeaveType.is_active.is_(True)).limit(1))
            if not lt:
                lt = db.scalar(select(LeaveType).limit(1))

            outcome = leave_service.submit(
                db,
                employee=emp,
                leave_type=lt,
                start=from_date,
                end=to_date,
                reason=reason or "Applied via Slack",
                enforce_backdate=False,
            )

            if not outcome.ok:
                return {
                    "response_action": "errors",
                    "errors": {"leave_reason_block": outcome.reason or "Could not apply for leave."},
                }

            leave_req = outcome.request
            db.commit()
            days_count = float(leave_req.days_consumed)

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
                    exclude_user_ids=[slack_user_id] if slack_user_id else None,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text=APPLICANT_WAIT_TEXT,
                )
            return {"response_action": "clear"}

        if callback_id == "submit_correction_request":
            date_str = values.get("correction_date_block", {}).get("correction_date_input", {}).get("selected_date")
            cat_val = values.get("correction_category_block", {}).get("correction_category_input", {}).get("selected_option", {}).get("value", "late_arrival")
            dir_val = values.get("correction_dir_block", {}).get("correction_dir_input", {}).get("selected_option", {}).get("value", "in")
            time_str = values.get("correction_time_block", {}).get("correction_time_input", {}).get("selected_time", "18:00")
            reason = values.get("correction_reason_block", {}).get("correction_reason_input", {}).get("value", "").strip()

            target_date = datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else org_today()
            target_dir = PunchDirection.IN if dir_val == "in" else PunchDirection.OUT

            from zoneinfo import ZoneInfo
            from app.services import corrections as correction_service
            try:
                hh, mm = [int(x) for x in (time_str or "18:00").split(":")[:2]]
                dt_local = datetime(target_date.year, target_date.month, target_date.day, hh, mm, tzinfo=ZoneInfo("Asia/Kolkata"))
                claimed_at_utc = dt_local.astimezone(timezone.utc)
            except Exception:
                claimed_at_utc = datetime.combine(target_date, time(18, 0), tzinfo=timezone.utc)

            outcome = correction_service.submit(
                db,
                employee=emp,
                shift_date=target_date,
                direction=target_dir,
                claimed_at=claimed_at_utc,
                reason=reason or "Applied via Slack",
                category=cat_val,
            )

            if not outcome.ok:
                return {
                    "response_action": "errors",
                    "errors": {"correction_reason_block": outcome.reason or "Could not submit correction request."},
                }

            corr_req = outcome.request
            db.commit()

            category_labels = {
                "late_arrival": "Late Arrival / Shift Regularization",
                "missed_check_in": "Missed Check-In",
                "missed_check_out": "Missed Check-Out",
                "device_glitch": "Biometric / Device Glitch",
                "other": "Other",
            }
            cat_label = category_labels.get(cat_val, cat_val)

            admin_blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "📝 Attendance Correction Request (Private to Admins)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp.full_name}* (`{emp.emp_code}`) requested an attendance correction:\n\n"
                                f"📅 *Shift Date:* {target_date.strftime('%d %b %Y')}\n"
                                f"🏷️ *Type:* {cat_label}\n"
                                f"⏰ *Claimed Punch:* {target_dir.value.upper()} at {time_str} IST\n"
                                f"📝 *Reason:* _{reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve Correction", "emoji": True},
                            "style": "primary",
                            "value": f"approve_correction:{corr_req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject_correction:{corr_req.id}",
                        },
                    ],
                },
            ]
            if channel_id:
                post_ephemeral_to_admins(
                    channel_id=channel_id,
                    text=f"Attendance correction from {emp.full_name}",
                    blocks=admin_blocks,
                    exclude_user_ids=[slack_user_id] if slack_user_id else None,
                )
                post_ephemeral_to_user(
                    channel_id=channel_id,
                    user_id=slack_user_id,
                    text=APPLICANT_WAIT_TEXT,
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
    trigger_id = data.get("trigger_id")

    # Shared gate for every approve/reject card (leave / late / early / wfh / correction).
    DECIDABLE_PREFIXES = (
        "approve_late:", "reject_late:",
        "approve_early:", "reject_early:",
        "approve_wfh:", "reject_wfh:",
        "approve_correction:", "reject_correction:",
        "approve:", "reject:", "partial_approve:",
    )
    if action_value.startswith(DECIDABLE_PREFIXES):
        refused = _refuse_non_admin(response_url, slack_user_id)
        if refused:
            return refused

        kind, _, request_id = action_value.partition(":")
        is_approve = kind.startswith("approve") or kind == "partial_approve"
        # Map request -> employee for self-decide check
        clicker_emp = _find_employee_by_slack(db, slack_user_id, slack_user)
        request_employee_id = _request_employee_id(db, kind, request_id)
        if request_employee_id is not None:
            refused = _refuse_self_decide(response_url, clicker_emp, request_employee_id)
            if refused:
                return refused

        if is_approve:
            # Mandatory approval reason via modal (including partial approve).
            if not trigger_id:
                return {"message": "Missing Slack trigger_id for approval reason"}
            return _open_approve_reason_modal(
                trigger_id=trigger_id,
                kind=kind,
                request_id=request_id,
                channel_id=channel_id,
                message_ts=message_ts,
                response_url=response_url,
            )

        # Reject proceeds immediately — no mandatory reason.
        result = _apply_admin_decision(
            db,
            kind=kind,
            request_id=request_id,
            approve=False,
            decision_reason=None,
            slack_user_id=slack_user_id,
            slack_user=slack_user,
            channel_id=channel_id,
            message_ts=message_ts,
            response_url=response_url,
            partial_approve=False,
        )
        return {"message": result.get("error") or "Success"}

    # Signup decline (admins only)
    if action_value.startswith("decline_signup:"):
        refused = _refuse_non_admin(response_url, slack_user_id)
        if refused:
            return refused

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

    return {"message": "Ignored unknown action"}


def _request_employee_id(db: Session, kind: str, request_id: str):
    """Resolve the employee_id for a pending Slack decide card."""
    try:
        rid = uuid.UUID(request_id)
    except ValueError:
        return None
    if kind in ("approve_late", "reject_late", "approve_early", "reject_early"):
        row = db.get(LateRequest, rid)
        return row.employee_id if row else None
    if kind in ("approve_wfh", "reject_wfh"):
        row = db.get(WFHRequest, rid)
        return row.employee_id if row else None
    if kind in ("approve_correction", "reject_correction"):
        from app.models.correction import CorrectionRequest
        row = db.get(CorrectionRequest, rid)
        return row.employee_id if row else None
    if kind in ("approve", "reject", "partial_approve"):
        row = db.get(LeaveRequest, rid)
        return row.employee_id if row else None
    return None


def _whisper_decision(
    *,
    channel_id: str | None,
    req_emp: Employee | None,
    text: str,
    response_url: str | None,
    admin_status: str,
) -> None:
    import httpx
    target = channel_id or settings.slack_channel_id
    emp_slack = slack_user_id_for_email(req_emp.email if req_emp else None)
    if target:
        notify_admins_and_employee(
            target,
            text=text,
            employee_slack_id=emp_slack,
        )
    if response_url:
        try:
            httpx.post(
                response_url,
                json={"text": admin_status, "replace_original": True},
                timeout=5.0,
            )
        except Exception:
            pass


def _apply_admin_decision(
    db: Session,
    *,
    kind: str,
    request_id: str,
    approve: bool,
    decision_reason: str | None,
    slack_user_id: str | None,
    slack_user: str,
    channel_id: str | None,
    message_ts: str | None,
    response_url: str | None,
    partial_approve: bool | None = None,
) -> dict:
    """Execute an admin decide for leave / late / early / wfh / correction.

    Approvals require a non-empty decision_reason. Never public-posts the outcome.
    """
    if partial_approve is None:
        partial_approve = kind == "partial_approve"
    if approve and not (decision_reason or "").strip():
        return {"error": "An approval reason is required."}

    if not is_slack_admin(slack_user_id):
        return {"error": "Only Holbox admins can approve or reject this request."}

    clicker_emp = _find_employee_by_slack(db, slack_user_id or "", slack_user)
    request_employee_id = _request_employee_id(db, kind, request_id)
    if (
        clicker_emp is not None
        and request_employee_id is not None
        and clicker_emp.id == request_employee_id
    ):
        return {"error": "You cannot approve or reject your own request. Another admin must decide."}

    approver = _slack_approver_user(db, slack_user_id or "", slack_user)
    if approver is None:
        approver = db.scalar(
            select(User).where(
                User.role.in_([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]),
                User.is_active.is_(True),
            ).limit(1)
        )
    if approver is None:
        return {"error": "No valid admin user found to record the decision."}

    note = (decision_reason or "").strip()
    if approve and partial_approve:
        note = (
            f"Partially approved via Slack by @{slack_user}. {note}. "
            "Please submit your medical certificate / doctor's prescription."
        )
    elif approve:
        note = f"Approved via Slack by @{slack_user}: {note}"
    else:
        note = f"Rejected via Slack by @{slack_user}" + (f": {note}" if note else "")

    try:
        rid = uuid.UUID(request_id)
    except ValueError:
        return {"error": "Invalid request id"}

    # --- Late / early (same table) ---
    if kind in ("approve_late", "reject_late", "approve_early", "reject_early"):
        late_req = db.get(LateRequest, rid)
        if not late_req:
            return {"error": "Request not found"}
        if late_req.status != CorrectionStatus.PENDING:
            return {"error": f"Already {late_req.status.value}"}
        req_emp = db.get(Employee, late_req.employee_id)
        is_early = kind.endswith("early") or (late_req.reason or "").startswith("[Early checkout]")
        late_req.status = CorrectionStatus.APPROVED if approve else CorrectionStatus.REJECTED
        late_req.decided_by_id = approver.id
        late_req.decided_by_slack_id = slack_user_id
        late_req.decided_by_name = slack_user
        late_req.decided_at = datetime.now(timezone.utc)
        late_req.decided_note = note
        db.commit()
        if req_emp and approve:
            from app.services.attendance import recompute_day
            recompute_day(db, req_emp, late_req.shift_date)
            db.commit()
        label = "early checkout" if is_early else "late arrival"
        outcome_text = (
            f"✅ Your *{label}* for *{late_req.shift_date.strftime('%d %b %Y')}* was *approved* by *@{slack_user}*.\n> {note}"
            if approve else
            f"❌ Your *{label}* for *{late_req.shift_date.strftime('%d %b %Y')}* was *rejected* by *@{slack_user}*."
        )
        _whisper_decision(
            channel_id=channel_id,
            req_emp=req_emp,
            text=outcome_text,
            response_url=response_url,
            admin_status=f"{'✅ Approved' if approve else '❌ Rejected'} {label} for {req_emp.full_name if req_emp else 'employee'} (by @{slack_user})",
        )
        return {"ok": True}

    # --- WFH ---
    if kind in ("approve_wfh", "reject_wfh"):
        wfh_req = db.get(WFHRequest, rid)
        if not wfh_req:
            return {"error": "WFH request not found"}
        if wfh_req.status != CorrectionStatus.PENDING:
            return {"error": f"Already {wfh_req.status.value}"}
        req_emp = db.get(Employee, wfh_req.employee_id)
        wfh_req.status = CorrectionStatus.APPROVED if approve else CorrectionStatus.REJECTED
        wfh_req.decided_at = datetime.now(timezone.utc)
        wfh_req.decided_note = note
        db.commit()
        if req_emp and approve:
            from app.services.attendance import recompute_day
            recompute_day(db, req_emp, wfh_req.shift_date)
            db.commit()
        outcome_text = (
            f"✅ Your *WFH* on *{wfh_req.shift_date.strftime('%d %b %Y')}* was *approved* by *@{slack_user}*.\n> {note}"
            if approve else
            f"❌ Your *WFH* on *{wfh_req.shift_date.strftime('%d %b %Y')}* was *rejected* by *@{slack_user}*."
        )
        _whisper_decision(
            channel_id=channel_id,
            req_emp=req_emp,
            text=outcome_text,
            response_url=response_url,
            admin_status=f"{'✅ Approved' if approve else '❌ Rejected'} WFH for {req_emp.full_name if req_emp else 'employee'} (by @{slack_user})",
        )
        return {"ok": True}

    # --- Correction / regularization ---
    if kind in ("approve_correction", "reject_correction"):
        from app.models.correction import CorrectionRequest
        from app.services import corrections as correction_service
        corr_req = db.get(CorrectionRequest, rid)
        if not corr_req:
            return {"error": "Correction request not found"}
        req_emp = db.get(Employee, corr_req.employee_id)
        outcome = correction_service.decide(
            db, request=corr_req, actor=approver, approve=approve, note=note,
        )
        if not outcome.ok:
            return {"error": outcome.reason or "Could not decide"}
        db.commit()
        outcome_text = (
            f"✅ Your *attendance correction* for *{corr_req.shift_date.strftime('%d %b %Y')}* was *approved* by *@{slack_user}*.\n> {note}"
            if approve else
            f"❌ Your *attendance correction* for *{corr_req.shift_date.strftime('%d %b %Y')}* was *rejected* by *@{slack_user}*."
        )
        _whisper_decision(
            channel_id=channel_id,
            req_emp=req_emp,
            text=outcome_text,
            response_url=response_url,
            admin_status=f"{'✅ Approved' if approve else '❌ Rejected'} correction for {req_emp.full_name if req_emp else 'employee'} (by @{slack_user})",
        )
        return {"ok": True}

    # --- Leave ---
    if kind in ("approve", "reject", "partial_approve"):
        leave_req = db.get(LeaveRequest, rid)
        if not leave_req:
            return {"error": "Leave request not found"}
        req_emp = db.get(Employee, leave_req.employee_id)
        outcome = leave_decide(
            db,
            request=leave_req,
            approver=approver,
            approve=approve,
            partial_approve=partial_approve,
            note=note,
            allow_self_approval=False,
        )
        if not outcome.ok:
            return {"error": outcome.reason or "Could not decide"}
        db.commit()
        action_word = (
            "partially approved" if partial_approve else ("approved" if approve else "rejected")
        )
        outcome_text = (
            f"🌴 Your *leave* ({leave_req.from_date.strftime('%d %b')}–{leave_req.to_date.strftime('%d %b')}) "
            f"was *{action_word}* by *@{slack_user}*.\n> {note}"
        )
        _whisper_decision(
            channel_id=channel_id,
            req_emp=req_emp,
            text=outcome_text,
            response_url=response_url,
            admin_status=f"Leave {action_word} for {req_emp.full_name if req_emp else 'employee'} (by @{slack_user})",
        )
        if channel_id and message_ts:
            update_leave_request(
                channel_id=channel_id,
                message_ts=message_ts,
                original_text="Leave Request",
                approved=approve,
                actor_name=slack_user,
                partial_approve=partial_approve,
                note=note if partial_approve else None,
            )
        return {"ok": True}

    return {"error": f"Unknown decision kind: {kind}"}


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
