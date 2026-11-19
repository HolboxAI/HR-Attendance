"""Run: uv run python tests/test_kiosk.py

Tests the kiosk backend endpoints:
1. GET /api/v1/kiosk/roster
2. POST /api/v1/kiosk/punch lifecycle & sequence validation:
   - Check out before check in (rejected)
   - Clock in (accepted)
   - Clock in again (rejected)
   - Break out (accepted)
   - Check out while on break (rejected)
   - Break in (accepted with break duration)
   - Break in again (rejected)
   - Clock out (accepted)
   - Clock out again (rejected)
"""
import os
import sys
import tempfile
import uuid
from datetime import datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-kiosk-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
import app.models
from app.main import app
from app.models.employee import Employee, User
from app.models.enums import PunchSource, UserRole
from app.models.face import FaceEnrollment
from app.models.org import Organization
from app.services.storage import storage

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"

ok = True

def check(label, got, want):
    global ok
    good = (got == want)
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


Base.metadata.create_all(engine)
storage.root = TMP / "uploads"
storage.root.mkdir(parents=True, exist_ok=True)

db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Kiosk Org")
db.add(org)
db.flush()

emp = Employee(
    id=uuid.uuid4(),
    org_id=org.id,
    emp_code="EMP999",
    full_name="Kiosk Tester",
    is_active=True,
)
db.add(emp)
db.flush()

# Add face enrollment for the employee
ref_key = f"enrolments/{emp.emp_code}/ref.jpg"
storage.put(ref_key, JPEG)
enrol = FaceEnrollment(
    id=uuid.uuid4(),
    org_id=org.id,
    employee_id=emp.id,
    photo_key=ref_key,
    is_active=True,
)
db.add(enrol)
db.commit()
db.close()

client = TestClient(app)

print("\n1. GET /api/v1/kiosk/roster")
resp = client.get("/api/v1/kiosk/roster")
check("roster status code", resp.status_code, 200)
roster = resp.json()
check("roster contains at least 1 employee", len(roster) >= 1, True)
matched = next((e for e in roster if e["emp_code"] == "EMP999"), None)
check("emp found in roster", bool(matched), True)
if matched:
    check("emp has_enrolled_face", matched["has_enrolled_face"], True)
    check("emp is_currently_in", matched["is_currently_in"], False)
    check("emp suggested direction", matched["direction"], "in")

print("\n2. Edge Case: Try to Check Out Before Clock In")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "check_out"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("punch status code", resp.status_code, 200)
body = resp.json()
check("checkout before check-in rejected", body.get("accepted"), False)
check("title is Check In Required", body.get("title"), "Check In Required")

print("\n3. POST /api/v1/kiosk/punch (Clock In)")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "check_in"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("punch status code", resp.status_code, 200)
body = resp.json()
check("punch accepted", body.get("accepted"), True)
check("punch emp_code", body.get("emp_code"), "EMP999")
check("title is Clocked In or Late Arrival", body.get("title") in ("Clocked In", "Late Arrival"), True)

print("\n4. Edge Case: Try to Clock In Again")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "check_in"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("double check-in rejected", resp.json().get("accepted"), False)
check("title is Already Clocked In", resp.json().get("title"), "Already Clocked In")

import time as _pytime
_pytime.sleep(1.05)

print("\n5. POST /api/v1/kiosk/punch (Break Out)")
files = {"selfie": ("break.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "break_out"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("break accepted", resp.json().get("accepted"), True)
check("title is Break Started", resp.json().get("title"), "Break Started")

_pytime.sleep(1.05)

print("\n6. Edge Case: Try to Check Out While On Break")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "check_out"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("checkout while on break rejected", resp.json().get("accepted"), False)
check("title is Break In Required", resp.json().get("title"), "Break In Required")

_pytime.sleep(1.05)

print("\n7. POST /api/v1/kiosk/punch (Break In / Completed Break with duration)")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "break_in"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
body = resp.json()
check("break in accepted", body.get("accepted"), True)
check("title is Break Completed", body.get("title"), "Break Completed")
check("break duration minutes calculated", body.get("break_duration_minutes") is not None, True)
check("break duration str calculated", body.get("break_duration_str") is not None, True)

_pytime.sleep(1.05)

print("\n8. Edge Case: Try to Break In Again When Not On Break")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "break_in"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("break in without break out rejected", resp.json().get("accepted"), False)
check("title is Break Not Started", resp.json().get("title"), "Break Not Started")

_pytime.sleep(1.05)

print("\n9. POST /api/v1/kiosk/punch (Clock Out)")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "check_out"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("checkout accepted", resp.json().get("accepted"), True)
check("title is Clocked Out", resp.json().get("title"), "Clocked Out")

_pytime.sleep(1.05)

print("\n10. Edge Case: Try to Clock Out Again")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "EMP999", "punch_type": "check_out"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("double checkout rejected", resp.json().get("accepted"), False)
check("title is Already Checked Out", resp.json().get("title"), "Already Checked Out")

print("\n11. POST /api/v1/kiosk/punch (Invalid Employee Code)")
files = {"selfie": ("selfie.jpg", JPEG, "image/jpeg")}
data = {"emp_code": "NONEXISTENT", "punch_type": "check_in"}
resp = client.post("/api/v1/kiosk/punch", files=files, data=data)
check("unknown emp returns 404", resp.status_code, 404)

if not ok:
    print("\nTESTS FAILED")
    sys.exit(1)
print("\nALL KIOSK TESTS PASSED")
