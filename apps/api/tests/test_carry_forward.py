"""Run: python3 tests/test_carry_forward.py

Leave year-end rollover. EL carries forward up to its cap; CL and SL lapse
because they were never given the flag. Idempotency matters here more than
almost anywhere else in the system - this moves real balance, and running it
twice must not double anyone's Earned Leave.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-carryforward-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from sqlalchemy import select                                  # noqa: E402

from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.models.employee import Employee                       # noqa: E402
from app.models.enums import AccrualRule                       # noqa: E402
from app.models.leave import CarryForwardRun, LeaveType         # noqa: E402
from app.models.org import Organization                        # noqa: E402
from app.services import leave as leave_service                # noqa: E402

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

nikunj = Employee(id=uuid.uuid4(), org_id=org.id, emp_code="BX002", full_name="Nikunj",
                  email="nikunj@test.local")
dhruv = Employee(id=uuid.uuid4(), org_id=org.id, emp_code="BX005", full_name="Dhruv",
                 email="dhruv@test.local")
db.add_all([nikunj, dhruv]); db.commit()

EL = LeaveType(id=uuid.uuid4(), org_id=org.id, code="EL", name="Earned Leave",
               annual_quota=15, accrual_rule=AccrualRule.MONTHLY,
               carries_forward=True, carry_cap=30, sort_order=1)
CL = LeaveType(id=uuid.uuid4(), org_id=org.id, code="CL", name="Casual Leave",
               annual_quota=12, accrual_rule=AccrualRule.MONTHLY,
               carries_forward=False, carry_cap=0, sort_order=2)
db.add_all([EL, CL]); db.commit()

FROM_PERIOD, TO_PERIOD = "2026", "2027"


def bal(emp, lt, period):
    db.expire_all()
    return leave_service.balance(db, emp, lt, period)


print("1. Earned Leave carries forward, up to the cap")
b = bal(nikunj, EL, FROM_PERIOD)
b.accrued, b.used = 15, 4          # 11 left, well under the 30 cap
db.commit()
r = leave_service.run_carry_forward(db, org_id=org.id, period=FROM_PERIOD)
check("one carried", r["credited"], 2)   # Nikunj EL + Dhruv EL (0 available)
check("target period computed correctly", r["to_period"], TO_PERIOD)
new = bal(nikunj, EL, TO_PERIOD)
check("11 days became next year's opening balance", float(new.opening), 11.0)
check("nothing accrued or used yet in the new period", float(new.accrued), 0.0)


print("2. The cap actually caps it")
b = bal(dhruv, EL, FROM_PERIOD)
b.accrued, b.used = 40, 0           # 40 available, cap is 30
db.commit()
r = leave_service.run_carry_forward(db, org_id=org.id, period=FROM_PERIOD)
# Dhruv's row for TO_PERIOD already exists from run 1 (0 carried then) - the
# unique key is per (employee, type, to_period), so this run is a no-op for
# him. Prove the cap on a fresh employee instead.
priya = Employee(id=uuid.uuid4(), org_id=org.id, emp_code="BX011", full_name="Priya",
                 email="priya@test.local")
db.add(priya); db.commit()
b = bal(priya, EL, FROM_PERIOD)
b.accrued, b.used = 40, 0
db.commit()
r = leave_service.run_carry_forward(db, org_id=org.id, period=FROM_PERIOD)
priya_new = bal(priya, EL, TO_PERIOD)
check("40 available, but capped at 30", float(priya_new.opening), 30.0)
runs = db.scalars(select(CarryForwardRun).where(
    CarryForwardRun.employee_id == priya.id)).all()
check("the run itself records what was available before the cap",
      float(runs[0].available_before_cap), 40.0)
check("and what was actually carried", float(runs[0].amount), 30.0)


print("3. Casual Leave does not carry - it lapses")
b = bal(nikunj, CL, FROM_PERIOD)
b.accrued, b.used = 12, 3           # 9 left
db.commit()
leave_service.run_carry_forward(db, org_id=org.id, period=FROM_PERIOD)
cl_new = bal(nikunj, CL, TO_PERIOD)
check("CL opening in the new period is zero - it lapsed", float(cl_new.opening), 0.0)
check("no carry-forward row was even attempted for CL",
      db.scalar(select(CarryForwardRun).where(
          CarryForwardRun.leave_type_id == CL.id)) is None, True)


print("4. Running it twice does not double anyone's balance")
before = float(bal(nikunj, EL, TO_PERIOD).opening)
r2 = leave_service.run_carry_forward(db, org_id=org.id, period=FROM_PERIOD)
after = float(bal(nikunj, EL, TO_PERIOD).opening)
check("opening balance unchanged on the second run", after, before)
check("second run reports nothing newly credited for anyone already done",
      r2["credited"], 0)
check("and reports how many it skipped", r2["skipped"] > 0, True)


print("5. Old period's balance is untouched - history is read, never rewritten")
old = bal(nikunj, EL, FROM_PERIOD)
check("2026's accrued figure is exactly what it was", float(old.accrued), 15.0)
check("2026's used figure is exactly what it was", float(old.used), 4.0)


print("6. It works across the leave-year boundary, not just calendar year")
db.expire_all()
pol = leave_service.policy(db, org.id)
pol.year_start_month = 4          # April-March
db.commit()
b = bal(nikunj, EL, "2026-27")
b.accrued, b.used = 20, 5
db.commit()
r = leave_service.run_carry_forward(db, org_id=org.id, period="2026-27")
check("next financial year label is correct", r["to_period"], "2027-28")
fy_new = bal(nikunj, EL, "2027-28")
check("15 days carried across the FY boundary", float(fy_new.opening), 15.0)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
