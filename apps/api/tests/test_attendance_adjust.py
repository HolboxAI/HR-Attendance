"""Run: python3 tests/test_attendance_adjust.py

An admin can change the status and clock times a day shows. Worked hours stay
the punch total. A reason is required, and the PDF carries who changed it.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-adjust-"))
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
from app.models.attendance import AttendanceAdjustment, ShiftAssignment, ShiftTemplate  # noqa: E402
from app.models.employee import Employee, User  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.models.org import Location, Organization  # noqa: E402
from app.services.attendance import recompute_day  # noqa: E402
from app.services.attendance_adjust import adjustment_remark  # noqa: E402
from app.services.export import attendance_history_to_pdf  # noqa: E402

PW = "a-test-only-passphrase"
DAY = date(2026, 8, 18)
ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    return good


print("1. The remark names the previous status and who changed it")
check(
    "remark",
    adjustment_remark("absent", "Ashley", "Gate was down"),
    "Was Absent. Changed by Ashley. Gate was down",
)

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
    )
    db.add(person)
    db.commit()
    db.add(ShiftAssignment(
        id=uuid.uuid4(), employee_id=person.id, shift_template_id=shift.id,
        effective_from=date(2026, 1, 1),
    ))
    db.add(User(
        id=uuid.uuid4(), org_id=org.id, employee_id=person.id, email=person.email,
        password_hash=hash_password(PW), role=role,
    ))
    db.commit()
    return person


ashley = make("BX006", "Ashley", UserRole.HR_ADMIN)
himesh = make("BX008", "Himesh", UserRole.HR_ADMIN)
daksh = make("BX004", "Daksh", UserRole.EMPLOYEE)
day = recompute_day(db, daksh, DAY)
db.commit()
worked_before = day.worked_minutes

client = TestClient(app)


def token(person):
    response = client.post("/api/v1/auth/login", json={"email": person.email, "password": PW})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


ASHLEY, HAMESH, DAKSH = token(ashley), token(himesh), token(daksh)

print("2. An employee cannot edit a day, and a blank reason is refused")
refused = client.post("/api/v1/admin/history/attendance/adjust", headers=DAKSH, json={
    "employee_code": "BX004", "shift_date": DAY.isoformat(), "status": "present", "reason": "no",
})
check("employee forbidden", refused.status_code, 403)
blank = client.post("/api/v1/admin/history/attendance/adjust", headers=ASHLEY, json={
    "employee_code": "BX004", "shift_date": DAY.isoformat(), "status": "present", "reason": "   ",
})
check("blank reason", blank.status_code, 400)

print("3. An admin can mark the day present and the worked hours stay put")
saved = client.post("/api/v1/admin/history/attendance/adjust", headers=ASHLEY, json={
    "employee_code": "BX004",
    "shift_date": DAY.isoformat(),
    "status": "present",
    "first_in": "09:10",
    "last_out": "18:05",
    "reason": "Gate was down",
})
check("saved", saved.status_code, 200)
body = saved.json()
check("status", body["status"], "present")
check("worked unchanged", body["worked_minutes"], worked_before)
check("regularised by", body["regularised_by"], "Ashley")
check("remark", body["remarks"], "Was Absent. Changed by Ashley. Gate was down")

db.expire_all()
again = recompute_day(db, daksh, DAY)
db.commit()
check("recompute does not invent hours", again.worked_minutes, worked_before)

print("4. A later edit replaces the line and keeps the earlier one")
again_saved = client.post("/api/v1/admin/history/attendance/adjust", headers=HAMESH, json={
    "employee_code": "BX004",
    "shift_date": DAY.isoformat(),
    "status": "absent",
    "reason": "He was not in",
})
check("second save", again_saved.status_code, 200)
check("now absent", again_saved.json()["status"], "absent")
check(
    "changed by Himesh",
    again_saved.json()["remarks"],
    "Was Present. Changed by Himesh. He was not in",
)
rows = db.scalars(select(AttendanceAdjustment).where(AttendanceAdjustment.employee_id == daksh.id)).all()
check("both edits kept", len(rows), 2)

print("5. The PDF uses the mail columns and the latest reason")
pdf = attendance_history_to_pdf(
    [again_saved.json()], DAY, DAY, "Test Org", filters_desc="Employee: Daksh",
)
check("pdf", pdf[:4], b"%PDF")
check("pdf row remark", again_saved.json()["remarks"].endswith("He was not in"), True)
check("pdf column present on the row", "punctuality" in again_saved.json(), True)

print("6. Adjust to half_day deducts 0.5d leave and sets status half_day")
from app.models.leave import LeaveType, LeaveBalance
cl = LeaveType(id=uuid.uuid4(), org_id=org.id, code="CL", name="Casual Leave", annual_quota=12.0)
db.add(cl)
db.commit()

hd_res = client.post("/api/v1/admin/history/attendance/adjust", headers=HAMESH, json={
    "employee_code": "BX004",
    "shift_date": DAY.isoformat(),
    "status": "half_day",
    "reason": "Personal work in second half",
    "leave_type_code": "CL",
})
check("half_day status code", hd_res.status_code, 200)
check("half_day status", hd_res.json()["status"], "half_day")
db.expire_all()
bal_hd = db.scalar(select(LeaveBalance).where(LeaveBalance.employee_id == daksh.id, LeaveBalance.leave_type_id == cl.id))
check("bal.used after half_day is 0.5", float(bal_hd.used) if bal_hd else 0.0, 0.5)

print("7. Adjust from half_day to on_leave deducts another 0.5d (1.0d total)")
leave_res = client.post("/api/v1/admin/history/attendance/adjust", headers=HAMESH, json={
    "employee_code": "BX004",
    "shift_date": DAY.isoformat(),
    "status": "on_leave",
    "reason": "Full day leave taken",
    "leave_type_code": "CL",
})
check("on_leave status code", leave_res.status_code, 200)
check("on_leave status", leave_res.json()["status"], "on_leave")
db.expire_all()
bal_leave = db.scalar(select(LeaveBalance).where(LeaveBalance.employee_id == daksh.id, LeaveBalance.leave_type_id == cl.id))
check("bal.used after on_leave is 1.0", float(bal_leave.used) if bal_leave else 0.0, 1.0)

print("8. Adjust from on_leave back to present restores the 1.0d balance")
present_res = client.post("/api/v1/admin/history/attendance/adjust", headers=HAMESH, json={
    "employee_code": "BX004",
    "shift_date": DAY.isoformat(),
    "status": "present",
    "first_in": "09:00",
    "last_out": "18:00",
    "reason": "Actually came and worked",
})
check("present status code", present_res.status_code, 200)
check("present status", present_res.json()["status"], "present")
db.expire_all()
bal_pres = db.scalar(select(LeaveBalance).where(LeaveBalance.employee_id == daksh.id, LeaveBalance.leave_type_id == cl.id))
check("bal.used after present restored to 0.0", float(bal_pres.used) if bal_pres else 0.0, 0.0)

print("9. Adjust to wfh sets status wfh and requires mandatory reason")
wfh_res = client.post("/api/v1/admin/history/attendance/adjust", headers=HAMESH, json={
    "employee_code": "BX004",
    "shift_date": DAY.isoformat(),
    "status": "wfh",
    "reason": "Approved remote day",
})
check("wfh status code", wfh_res.status_code, 200)
check("wfh status", wfh_res.json()["status"], "wfh")

print("10. Blank reason is refused across all 5 statuses")
for st in ("present", "absent", "half_day", "on_leave", "wfh"):
    r_bad = client.post("/api/v1/admin/history/attendance/adjust", headers=HAMESH, json={
        "employee_code": "BX004", "shift_date": DAY.isoformat(), "status": st, "reason": "   ",
    })
    check(f"blank reason for {st} refused", r_bad.status_code, 400)

print()
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
