"""Run: python3 tests/test_ex_employees.py

Tests for Ex-Employees: offboarding/deactivation, listing inactive only,
viewing history without 404, and reactivation.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-ex-emp-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
import app.models  # noqa: F401,E402
from app.main import app  # noqa: E402
from app.models.attendance import AttendanceDay, AttendanceStatus, ShiftAssignment, ShiftTemplate  # noqa: E402
from app.models.employee import Employee, User  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.models.org import Location, Organization  # noqa: E402

PW = "TestPassword123!"

Base.metadata.create_all(engine)
db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org)
db.commit()
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office")
db.add(loc)
db.commit()
shift = ShiftTemplate(
    id=uuid.uuid4(), org_id=org.id, name="General",
    start_time=time(9, 0), end_time=time(18, 0), break_minutes=60,
    grace_minutes=10, half_day_after_minutes=240, full_day_after_minutes=450,
    cutover_hour=5, working_days=[0, 1, 2, 3, 4],
)
db.add(shift)
db.commit()


def make(code, name, role):
    person = Employee(
        id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
        email=f"{name.lower()}@test.local", location_id=loc.id,
        date_of_joining=date(2025, 1, 1),
    )
    db.add(person)
    db.commit()
    db.add(ShiftAssignment(
        id=uuid.uuid4(), employee_id=person.id, shift_template_id=shift.id,
        effective_from=date(2026, 1, 1),
    ))
    db.add(User(
        id=uuid.uuid4(), org_id=org.id, employee_id=person.id, email=person.email,
        password_hash=hash_password(PW), role=role, is_active=True,
    ))
    db.commit()
    return person


himesh = make("BX008", "Himesh", UserRole.HR_ADMIN)
daksh = make("BX004", "Daksh", UserRole.EMPLOYEE)

# Add an attendance day record for Daksh
att_day = AttendanceDay(
    id=uuid.uuid4(),
    org_id=org.id,
    employee_id=daksh.id,
    shift_date=date(2026, 10, 1),
    shift_template_id=shift.id,
    status=AttendanceStatus.PRESENT,
    worked_minutes=540,
)
db.add(att_day)
db.commit()

client = TestClient(app)


def token(person):
    response = client.post("/api/v1/auth/login", json={"email": person.email, "password": PW})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


HIMESH = token(himesh)


def run_tests():
    print("Test 1: Deactivate employee with date_of_exit and reason")
    r = client.post(
        "/api/v1/admin/employees/BX004/deactivate",
        json={"date_of_exit": "2026-10-25", "reason": "Moved to higher studies"},
        headers=HIMESH,
    )
    assert r.status_code == 200, f"Deactivate failed: {r.text}"
    data = r.json()
    assert data["is_active"] is False
    assert data["date_of_exit"] == "2026-10-25"
    print("  [PASS] Employee deactivated successfully.")

    print("Test 2: Excluded from active employee directory list")
    r = client.get("/api/v1/admin/employees", headers=HIMESH)
    assert r.status_code == 200
    active_codes = [e["emp_code"] for e in r.json()]
    assert "BX004" not in active_codes
    assert "BX008" in active_codes
    print("  [PASS] BX004 is excluded from active directory.")

    print("Test 3: Included in inactive_only query for Ex-Employees page")
    r = client.get("/api/v1/admin/employees?inactive_only=true", headers=HIMESH)
    assert r.status_code == 200
    inactive_codes = [e["emp_code"] for e in r.json()]
    assert "BX004" in inactive_codes
    assert "BX008" not in inactive_codes
    print("  [PASS] BX004 is listed in inactive_only query.")

    print("Test 4: Accessing profile / month attendance for Ex-Employee works without 404")
    r = client.get("/api/v1/admin/month?employee_code=BX004&year=2026&month=10", headers=HIMESH)
    assert r.status_code == 200, f"Failed to get month for ex-employee: {r.text}"
    month_data = r.json()
    assert month_data["employee_code"] == "BX004"
    assert len(month_data["days"]) > 0
    print("  [PASS] Month attendance history successfully retrieved for Ex-Employee.")

    print("Test 5: Exporting employee PDF for Ex-Employee works without 404")
    r = client.get("/api/v1/admin/export/employee.pdf?employee_code=BX004&year=2026&month=10", headers=HIMESH)
    assert r.status_code == 200, f"Failed to export PDF: {r.text}"
    assert r.headers["content-type"] == "application/pdf"
    print("  [PASS] Export PDF successfully generated for Ex-Employee.")

    print("Test 6: Reactivate employee back to active directory")
    r = client.post("/api/v1/admin/employees/BX004/reactivate", headers=HIMESH)
    assert r.status_code == 200, f"Reactivate failed: {r.text}"
    data = r.json()
    assert data["is_active"] is True
    assert data["date_of_exit"] is None
    print("  [PASS] Employee reactivated successfully.")

    print("Test 7: Reactivated employee reappears in active directory and disappears from inactive_only")
    r = client.get("/api/v1/admin/employees", headers=HIMESH)
    assert "BX004" in [e["emp_code"] for e in r.json()]
    r_inactive = client.get("/api/v1/admin/employees?inactive_only=true", headers=HIMESH)
    assert "BX004" not in [e["emp_code"] for e in r_inactive.json()]
    print("  [PASS] Reactivated employee is back in active directory.")

    print("\nALL 7 EX-EMPLOYEE TESTS PASSED SUCCESSFULLY! 🚀")


if __name__ == "__main__":
    run_tests()
