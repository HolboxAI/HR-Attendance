"""Resend any pending WFH, Leave, Late, and Correction requests to Admins via permanent Bot DM.

Usage:
    .venv/bin/python scripts/sync_pending_requests_to_slack.py
"""
import sys
from datetime import datetime, time, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.correction import CorrectionRequest
from app.models.employee import Employee
from app.models.enums import CorrectionStatus, LeaveStatus, PunchDirection
from app.models.late_request import LateRequest
from app.models.leave import LeaveRequest, LeaveType
from app.models.wfh_request import WFHRequest
from app.services.slack import post_ephemeral_to_admins


def sync_pending():
    db = SessionLocal()
    try:
        # 1. Pending WFH Requests
        wfh_list = db.scalars(
            select(WFHRequest)
            .where(WFHRequest.status == CorrectionStatus.PENDING)
            .order_by(WFHRequest.created_at)
        ).all()
        print(f"Found {len(wfh_list)} pending WFH request(s).")
        for req in wfh_list:
            emp = db.get(Employee, req.employee_id)
            emp_name = emp.full_name if emp else "Employee"
            emp_code = f" (`{emp.emp_code}`)" if emp and emp.emp_code else ""
            target_date = req.shift_date
            reason = req.reason or "No reason provided"
            blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🏠 Pending WFH Request (Admin Review)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp_name}*{emp_code} requested Work From Home on *{target_date.strftime('%d %b %Y')}*.\n📝 *Reason:* _{reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve WFH", "emoji": True},
                            "style": "primary",
                            "value": f"approve_wfh:{req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject_wfh:{req.id}",
                        },
                    ],
                },
            ]
            print(f" -> Sending WFH DM to admins for {emp_name} ({target_date})...")
            post_ephemeral_to_admins(None, f"WFH request from {emp_name}", blocks=blocks)

        # 2. Pending Corrections
        corr_list = db.scalars(
            select(CorrectionRequest)
            .where(CorrectionRequest.status == CorrectionStatus.PENDING)
            .order_by(CorrectionRequest.created_at)
        ).all()
        print(f"Found {len(corr_list)} pending Correction request(s).")
        category_labels = {
            "late_arrival": "Late Arrival / Shift Regularization",
            "missed_check_in": "Missed Check-In",
            "missed_check_out": "Missed Check-Out",
            "device_glitch": "Biometric / Device Glitch",
            "other": "Other",
        }
        for req in corr_list:
            emp = db.get(Employee, req.employee_id)
            emp_name = emp.full_name if emp else "Employee"
            emp_code = f" (`{emp.emp_code}`)" if emp and emp.emp_code else ""
            cat_label = category_labels.get(req.category or "", req.category or "Correction")
            claimed_str = req.claimed_at.strftime("%I:%M %p UTC") if req.claimed_at else "N/A"
            dir_str = (req.direction.value if req.direction else "in").upper()
            blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "📝 Pending Correction Request (Admin Review)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp_name}*{emp_code} requested an attendance correction:\n\n"
                                f"📅 *Shift Date:* {req.shift_date.strftime('%d %b %Y')}\n"
                                f"🏷️ *Type:* {cat_label}\n"
                                f"⏰ *Claimed Punch:* {dir_str} ({claimed_str})\n"
                                f"📝 *Reason:* _{req.reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve Correction", "emoji": True},
                            "style": "primary",
                            "value": f"approve_correction:{req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject_correction:{req.id}",
                        },
                    ],
                },
            ]
            print(f" -> Sending Correction DM to admins for {emp_name} ({req.shift_date})...")
            post_ephemeral_to_admins(None, f"Attendance correction from {emp_name}", blocks=blocks)

        # 3. Pending Late / Early checkout requests
        late_list = db.scalars(
            select(LateRequest)
            .where(LateRequest.status == CorrectionStatus.PENDING)
            .order_by(LateRequest.created_at)
        ).all()
        print(f"Found {len(late_list)} pending Late/Early request(s).")
        for req in late_list:
            emp = db.get(Employee, req.employee_id)
            emp_name = emp.full_name if emp else "Employee"
            emp_code = f" (`{emp.emp_code}`)" if emp and emp.emp_code else ""
            is_early = (req.reason or "").startswith("[Early checkout]")
            if is_early:
                prefix = "🏃 Pending Early Checkout Request (Admin Review)"
                approve_val = f"approve_early:{req.id}"
                reject_val = f"reject_early:{req.id}"
                btn_txt = "✅ Approve Early Checkout"
            else:
                prefix = "⏰ Pending Late Arrival Request (Admin Review)"
                approve_val = f"approve_late:{req.id}"
                reject_val = f"reject_late:{req.id}"
                btn_txt = "✅ Approve Regularization"

            blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": prefix, "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp_name}*{emp_code} submitted a request on *{req.shift_date.strftime('%d %b %Y')}*.\n📝 *Reason:* _{req.reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": btn_txt, "emoji": True},
                            "style": "primary",
                            "value": approve_val,
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": reject_val,
                        },
                    ],
                },
            ]
            print(f" -> Sending Late/Early DM to admins for {emp_name} ({req.shift_date})...")
            post_ephemeral_to_admins(None, f"Request from {emp_name}", blocks=blocks)

        # 4. Pending Leave requests
        leave_list = db.scalars(
            select(LeaveRequest)
            .where(LeaveRequest.status == LeaveStatus.PENDING)
            .order_by(LeaveRequest.created_at)
        ).all()
        print(f"Found {len(leave_list)} pending Leave request(s).")
        for req in leave_list:
            emp = db.get(Employee, req.employee_id)
            emp_name = emp.full_name if emp else "Employee"
            emp_code = f" (`{emp.emp_code}`)" if emp and emp.emp_code else ""
            days_count = float(req.days_consumed or 1.0)
            lt = db.get(LeaveType, req.leave_type_id) if req.leave_type_id else None
            lt_name = lt.name if lt else "Leave"
            blocks = [
                {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🌴 Pending Leave Request (Admin Review)", "emoji": True},
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{emp_name}*{emp_code} requested *{days_count:g} days* of {lt_name} from *{req.from_date.strftime('%d %b %Y')}* to *{req.to_date.strftime('%d %b %Y')}*.\n📝 *Reason:* _{req.reason}_",
                    },
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "✅ Approve Leave", "emoji": True},
                            "style": "primary",
                            "value": f"approve:{req.id}",
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "❌ Reject", "emoji": True},
                            "style": "danger",
                            "value": f"reject:{req.id}",
                        },
                    ],
                },
            ]
            print(f" -> Sending Leave DM to admins for {emp_name} ({req.from_date} to {req.to_date})...")
            post_ephemeral_to_admins(None, f"Leave request from {emp_name}", blocks=blocks)

        print("Done syncing pending requests to Slack DMs.")
    finally:
        db.close()


if __name__ == "__main__":
    sync_pending()
