"""Unit test for Slack slash commands, interactive modals, late approval status override, and biometric punch links."""

import json
import os
import sys
import tempfile
import uuid
from datetime import date, datetime, time, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="holbox-slack-test-"))
db_url = f"sqlite:///{TMP / 'test.db'}"
os.environ["DATABASE_URL"] = db_url
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")
os.environ["SLACK_BOT_TOKEN"] = ""
os.environ["SLACK_SIGNING_SECRET"] = ""
os.environ["SLACK_CHANNEL_ID"] = "C12345"
os.environ["DISABLE_GEOFENCE"] = "true"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
settings.database_url = db_url
settings.slack_bot_token = None
settings.slack_signing_secret = None
settings.slack_channel_id = "C12345"
settings.disable_geofence = True

from app.db.base import Base
import app.db.session as session_module
session_module.engine = create_engine(db_url, connect_args={"check_same_thread": False})
session_module.SessionLocal = sessionmaker(bind=session_module.engine, autoflush=False, autocommit=False)
engine = session_module.engine
SessionLocal = session_module.SessionLocal

import app.models
from app.main import app

from app.models.attendance import AttendanceDay, ShiftTemplate
from app.models.employee import Employee, User
from app.models.enums import AttendanceStatus, CorrectionStatus, EmploymentType, UserRole
from app.models.late_request import LateRequest
from app.models.org import Organization
from app.services.attendance import recompute_day


def test_slack_operations_and_late_overrides():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    from app.db.session import get_db
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    # 1. Setup Organization & Shift
    org = Organization(id=uuid.uuid4(), name="Holbox AI", timezone="Asia/Kolkata")
    db.add(org)
    db.commit()

    tmpl = ShiftTemplate(
        id=uuid.uuid4(),
        org_id=org.id,
        name="General Shift",
        start_time=time(9, 30),
        end_time=time(18, 30),
        grace_minutes=10,
    )
    db.add(tmpl)
    db.commit()

    # 2. Setup Employee
    emp = Employee(
        id=uuid.uuid4(),
        org_id=org.id,
        emp_code="HOL001",
        full_name="Krish Sharma",
        email="krish@holbox.ai",
        is_active=True,
        employment_type=EmploymentType.FULL_TIME,
    )
    db.add(emp)
    db.commit()

    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        employee_id=emp.id,
        email="krish@holbox.ai",
        password_hash="test",
        role=UserRole.SUPER_ADMIN,
        is_active=True,
    )
    db.add(user)
    db.commit()

    # 3. Test /checkin Slash Command -> Returns 1-click biometric punch link
    resp = client.post(
        "/api/v1/slack/commands",
        data={
            "command": "/checkin",
            "user_id": "U0BQ8EHQ6KC",
            "user_name": "krish",
            "channel_id": "C12345",
            "trigger_id": "trig123",
            "text": "",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    print("Command response data:", data)
    assert data["response_type"] == "ephemeral"
    assert "Tap to Check-In" in json.dumps(data)
    print("✅ /checkin returned valid 1-click ephemeral punch card")

    # 4. Test Late Arrival submission via modal interaction
    today_date = date.today()
    modal_payload = {
        "type": "view_submission",
        "user": {"id": "U0BQ8EHQ6KC", "name": "Krish Sharma"},
        "view": {
            "callback_id": "submit_late_request",
            "private_metadata": json.dumps({"channel_id": "C12345", "user_id": "U0BQ8EHQ6KC"}),
            "state": {
                "values": {
                    "late_reason_block": {
                        "late_reason_input": {"value": "Doctor appointment in morning"}
                    }
                }
            },
        },
    }

    resp = client.post(
        "/api/v1/slack/interactions",
        data={"payload": json.dumps(modal_payload)},
    )
    assert resp.status_code == 200
    assert resp.json() == {"response_action": "clear"}

    # Verify LateRequest row created in DB
    late_req = db.scalar(
        select(LateRequest).where(
            LateRequest.employee_id == emp.id,
            LateRequest.shift_date == today_date,
        )
    )
    assert late_req is not None
    assert late_req.reason == "Doctor appointment in morning"
    assert late_req.status == CorrectionStatus.PENDING
    print("✅ Late arrival modal submission recorded in database as PENDING")

    # 5. Check attendance before approval -> Absent / Not Marked
    day_before = recompute_day(db, emp, today_date)
    assert day_before.status in (AttendanceStatus.ABSENT, AttendanceStatus.NOT_MARKED)

    # 6. Test Admin Approval via Block Action button click
    action_payload = {
        "type": "block_actions",
        "user": {"id": "U0BQ8HZ3MKJ", "name": "himesh"},
        "channel": {"id": "C12345"},
        "actions": [{"value": f"approve_late:{late_req.id}"}],
    }
    resp = client.post(
        "/api/v1/slack/interactions",
        data={"payload": json.dumps(action_payload)},
    )
    assert resp.status_code == 200
    assert resp.json() == {"message": "Success"}

    # Verify LateRequest updated to APPROVED
    db.refresh(late_req)
    assert late_req.status == CorrectionStatus.APPROVED
    assert late_req.decided_by_name == "himesh"

    # 7. Check attendance after approval -> MUST BE OVERRIDDEN TO PRESENT
    day_after = recompute_day(db, emp, today_date)
    assert day_after.status == AttendanceStatus.PRESENT
    assert day_after.is_regularized is True
    print("✅ Admin approval successfully converted status to PRESENT in DB & attendance resolver")

    db.close()
    print("🎉 All Slack operations, privacy modals, and late overrides verified successfully!")


if __name__ == "__main__":
    test_slack_operations_and_late_overrides()
