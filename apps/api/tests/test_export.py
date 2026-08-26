"""Run: python3 tests/test_export.py

Covers the PRD acceptance criterion "Month-end attendance exports to Excel in
one click", plus the scoping rules the export inherits from the board.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import csv
import io
import os
import sys
import tempfile
import uuid
from datetime import date, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-export-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from datetime import datetime                                  # noqa: E402
from fastapi.testclient import TestClient                      # noqa: E402
from sqlalchemy import select                                  # noqa: E402

from app.core.security import hash_password                    # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.main import app                                       # noqa: E402
from app.models.attendance import ShiftAssignment, ShiftTemplate   # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import (                                 # noqa: E402
    AccrualRule, PunchDirection, PunchSource, UserRole,
)
from app.models.leave import Holiday, LeaveType                # noqa: E402
from app.models.org import Department, Location, Organization  # noqa: E402
from app.services import leave as leave_service                # noqa: E402
from app.services.attendance import record_punch               # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
PW = "a-test-only-passphrase"
YEAR, MONTH = 2026, 6          # a settled month in the past

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


Base.metadata.create_all(engine)
db = SessionLocal()

org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org); db.commit()
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office")
dept = Department(id=uuid.uuid4(), org_id=org.id, name="Engineering")
db.add_all([loc, dept]); db.commit()

shift = ShiftTemplate(
    id=uuid.uuid4(), org_id=org.id, name="General",
    start_time=time(9, 30), end_time=time(18, 30), break_minutes=60,
    grace_minutes=15, half_day_after_minutes=240, full_day_after_minutes=450,
    cutover_hour=5, working_days=[0, 1, 2, 3, 4],
)
db.add(shift); db.commit()


def make(code, name, role, manager=None):
    e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                 email=f"{name.lower()}@test.local", location_id=loc.id,
                 department_id=dept.id, manager_id=manager.id if manager else None)
    db.add(e); db.commit()
    db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=e.id,
                           shift_template_id=shift.id, effective_from=date(2026, 1, 1)))
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=e.id, email=e.email,
                password_hash=hash_password(PW), role=role))
    db.commit()
    return e


ashley = make("BX006", "Ashley", UserRole.HR_ADMIN)
maya = make("BX008", "Maya", UserRole.MANAGER)
nikunj = make("BX002", "Nikunj", UserRole.EMPLOYEE, manager=maya)
ritesh = make("BX007", "Ritesh", UserRole.EMPLOYEE)

db.add(LeaveType(id=uuid.uuid4(), org_id=org.id, code="EL", name="Earned Leave",
                 annual_quota=15, accrual_rule=AccrualRule.MONTHLY, is_paid=True))
db.add(LeaveType(id=uuid.uuid4(), org_id=org.id, code="LOP", name="Loss of Pay",
                 annual_quota=0, accrual_rule=AccrualRule.NONE, is_paid=False))
db.commit()
EL = db.scalar(select(LeaveType).where(LeaveType.code == "EL"))
LOP = db.scalar(select(LeaveType).where(LeaveType.code == "LOP"))

# A known month for Nikunj: one worked day, one holiday, paid leave, unpaid leave.
WORKED = date(2026, 6, 2)      # Tuesday
HOL = date(2026, 6, 3)         # Wednesday
PAID = date(2026, 6, 4)        # Thursday
UNPAID = date(2026, 6, 5)      # Friday
assert WORKED.weekday() == 1 and UNPAID.weekday() == 4

db.add(Holiday(id=uuid.uuid4(), org_id=org.id, day=HOL, name="Test Holiday"))
db.commit()

for hh, mm in ((9, 30), (18, 30)):
    record_punch(db, org_id=org.id, employee=nikunj,
                 event_ts=datetime.combine(WORKED, time(hh, mm), tzinfo=IST),
                 source=PunchSource.MOBILE_APP, direction=PunchDirection.UNKNOWN,
                 geofence_ok=True, face_ok=True)
db.commit()

hr_user = db.scalar(select(User).where(User.email == ashley.email))
period = leave_service.period_for(leave_service.policy(db, org.id), PAID)

for lt, day in ((EL, PAID), (LOP, UNPAID)):
    # Credit the balance BEFORE applying - submit() refuses an over-balance
    # request, which is exactly what test_leave asserts it should do.
    bal = leave_service.balance(db, nikunj, lt, period)
    bal.accrued = 20
    db.commit()
    r = leave_service.submit(db, employee=nikunj, leave_type=lt, start=day, end=day,
                             enforce_backdate=False)
    assert r.ok, r.reason
    d = leave_service.decide(db, request=r.request, approver=hr_user, approve=True)
    assert d.ok, d.reason
    db.commit()

client = TestClient(app)


def token(emp):
    r = client.post("/api/v1/auth/login", json={"email": emp.email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


ASHLEY, MAYA, NIKUNJ = token(ashley), token(maya), token(nikunj)
URL = f"/api/v1/admin/export/month.csv?year={YEAR}&month={MONTH}"


def fetch(headers):
    r = client.get(URL, headers=headers)
    return r, list(csv.reader(io.StringIO(r.text)))


print("1. It downloads as a file, in one request")
r, rows = fetch(ASHLEY)
check("200", r.status_code, 200)
check("is CSV", r.headers["content-type"].startswith("text/csv"), True)
check("is an attachment", "attachment" in r.headers.get("content-disposition", ""), True)
check("filename carries the month",
      f"attendance-{YEAR}-{MONTH:02d}.csv" in r.headers["content-disposition"], True)
check("not cached", r.headers.get("cache-control"), "no-store")

print("2. It is a register: one row per employee, one column per day")
header = next(row for row in rows if row and row[0] == "Code")
check("header starts Code/Name/Department", header[:3], ["Code", "Name", "Department"])
check("30 day columns for June", sum(1 for h in header if h[:2].isdigit()), 30)
body = [row for row in rows if row and row[0].startswith("BX")]
check("every employee has a row", len(body), 4)
check("row is header-length", len(body[0]), len(header))

print("3. The day codes reflect what actually happened")
idx = {h: i for i, h in enumerate(header)}
nik = next(row for row in body if row[0] == nikunj.emp_code)


def day_code(d: date) -> str:
    return nik[idx[f"{d.day:02d} {d:%a}"]]


check("worked day reads P", day_code(WORKED), "P")
check("holiday reads PH", day_code(HOL), "PH")
check("approved leave reads L", day_code(PAID), "L")
check("unpaid leave also reads L", day_code(UNPAID), "L")
check("a Sunday reads WO", day_code(date(2026, 6, 7)), "WO")

print("4. Totals add up, and unpaid leave is broken out")
check("present", nik[idx["Present"]], "1")
check("leave counted", nik[idx["Leave"]], "2")
check("of which LOP", nik[idx["of which LOP"]], "1")
check("holidays", nik[idx["Holidays"]], "1")
# 1 present + 1 paid leave + 1 holiday + 8 weekly offs in June 2026 = 11
check("days payable excludes the LOP day", nik[idx["Days payable"]], "11")
# 09:30 to 18:30 is nine hours. worked_minutes is time BETWEEN punches, not
# the shift length minus a nominal break - the break is only deducted when
# somebody actually punches out for it, which is the honest reading.
check("hours worked is elapsed time, not shift-minus-break",
      nik[idx["Hours worked"]], "9:00")

print("5. It is scoped like the board, not open to everyone")
check("employee refused", client.get(URL, headers=NIKUNJ).status_code, 403)
check("signed out refused", client.get(URL).status_code, 401)
_, mrows = fetch(MAYA)
mcodes = {row[0] for row in mrows if row and row[0].startswith("BX")}
check("manager sees their report", nikunj.emp_code in mcodes, True)
check("manager sees themselves", maya.emp_code in mcodes, True)
check("manager does NOT see Ritesh", ritesh.emp_code in mcodes, False)
check("HR sees everyone", len(body), 4)

print("6. It is recomputed at export time, not read from a stale cache")
# Add a holiday that was never there when those days were first computed.
LATE = date(2026, 6, 10)
db.add(Holiday(id=uuid.uuid4(), org_id=org.id, day=LATE, name="Added Later"))
db.commit()
_, rows2 = fetch(ASHLEY)
nik2 = next(row for row in rows2 if row and row[0] == nikunj.emp_code)
check("newly added holiday shows immediately",
      nik2[idx[f"{LATE.day:02d} {LATE:%a}"]], "PH")

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
