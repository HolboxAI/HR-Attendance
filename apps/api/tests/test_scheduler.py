"""Run: python3 tests/test_scheduler.py

The in-process scheduler: monthly accrual on a timer, "not checked in" past
the late threshold, "you haven't punched out" after shift end. Every group
drives the jobs with an explicit `now` - the whole point of tick(now) taking
a clock instead of reading one - so a week of mornings replays in a second.

The property under test everywhere is idempotence: the loop fires every
minute, so a job that is not a no-op on its second firing is a bug by
construction here, not an edge case.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-scheduler-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
# Pinned, not inherited - see test_carry_forward.py for why.
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from sqlalchemy import select                                   # noqa: E402

from app.db.base import Base                                    # noqa: E402
from app.db.session import SessionLocal, engine                 # noqa: E402
import app.models                                               # noqa: F401,E402
from app.models.attendance import ShiftAssignment, ShiftTemplate  # noqa: E402
from app.models.employee import Employee, User                  # noqa: E402
from app.models.enums import (                                  # noqa: E402
    AccrualRule, LeaveStatus, PunchDirection, PunchSource, UserRole,
)
from app.models.leave import Holiday, LeaveRequest, LeaveType   # noqa: E402
from app.models.notification import Notification                # noqa: E402
from app.models.org import Organization                         # noqa: E402
from app.models.scheduler import ScheduledJobRun                # noqa: E402
from app.services.attendance import record_punch                # noqa: E402
from app.services.scheduler import (                            # noqa: E402
    run_late_alerts, run_monthly_accrual, run_punch_out_nudges, tick,
)

IST = ZoneInfo("Asia/Kolkata")
ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


def at(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=IST)


Base.metadata.create_all(engine)
db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org); db.commit()


def emp(code, name, *, manager=None, role=None, night=False):
    e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                 email=f"{code.lower()}@test.local",
                 manager_id=manager.id if manager else None)
    db.add(e); db.flush()
    u = None
    if role is not None:
        u = User(id=uuid.uuid4(), org_id=org.id, employee_id=e.id,
                 email=f"{code.lower()}@test.local", password_hash="x", role=role)
        db.add(u)
    db.commit()
    return e, u


# Everyone but Ritesh rides DEFAULT_POLICY: 09:00-18:00, grace 10, Mon-Sat.
# With late_alert_after_minutes=30 the alert is due at 09:40.
himesh, himesh_u = emp("BX000", "Himesh", role=UserRole.HR_ADMIN)
shivam, shivam_u = emp("BX001", "Shivam", manager=himesh, role=UserRole.EMPLOYEE)
daksh, _none = emp("BX002", "Daksh", manager=himesh)           # no login at all
nikunj, nikunj_u = emp("BX003", "Nikunj", manager=himesh, role=UserRole.EMPLOYEE)
karan, karan_u = emp("BX004", "Karan", manager=himesh, role=UserRole.EMPLOYEE)
tanvi, tanvi_u = emp("BX005", "Tanvi", manager=himesh, role=UserRole.EMPLOYEE)
ritesh, ritesh_u = emp("BX007", "Ritesh", manager=himesh, role=UserRole.EMPLOYEE)

night = ShiftTemplate(id=uuid.uuid4(), org_id=org.id, name="Night",
                      start_time=time(22, 0), end_time=time(6, 0))
db.add(night); db.flush()
db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=ritesh.id,
                       shift_template_id=night.id, effective_from=date(2026, 1, 1)))

EL = LeaveType(id=uuid.uuid4(), org_id=org.id, code="EL", name="Earned Leave",
               annual_quota=12, accrual_rule=AccrualRule.MONTHLY)
db.add(EL); db.commit()


def punch(employee, ts, direction):
    record_punch(db, org_id=org.id, employee=employee, event_ts=ts,
                 source=PunchSource.MOBILE_APP, direction=direction)
    db.commit()


def notes(user, category, contains=""):
    rows = db.scalars(select(Notification).where(
        Notification.user_id == user.id, Notification.category == category,
    )).all()
    return [r for r in rows if contains in r.title]


def runs(job):
    return db.scalars(select(ScheduledJobRun).where(
        ScheduledJobRun.job_name == job)).all()


# Friday 2026-08-28 is "today" for most groups. In the ground truth already
# laid down: Nikunj punched in at 09:05 (so he is never "late"), Karan is in
# at 09:00, and Tanvi punched in YESTERDAY morning and never out.
punch(nikunj, at(2026, 8, 28, 9, 5), PunchDirection.IN)
punch(karan, at(2026, 8, 28, 9, 0), PunchDirection.IN)
punch(tanvi, at(2026, 8, 27, 9, 5), PunchDirection.IN)

print("1. Monthly accrual fires once per month, and tells HR")
r = run_monthly_accrual(db, org, at(2026, 8, 28, 10, 0)); db.commit()
check("first firing credits everyone (7 employees x 1 type)", r["credited"], 7)
r2 = run_monthly_accrual(db, org, at(2026, 8, 28, 10, 1)); db.commit()
check("second firing is a no-op", r2, None)
check("exactly one run row for the month", len(runs("monthly_accrual")), 1)
check("HR was told, once", len(notes(himesh_u, "leave_accrual")), 1)
check("the run row keeps the result", runs("monthly_accrual")[0].detail["credited"], 7)

print("2. Late alert: due at 09:40, once, to the person and their manager")
keys = run_late_alerts(db, org, at(2026, 8, 28, 9, 39)); db.commit()
check("nothing before the threshold", keys, [])
keys = run_late_alerts(db, org, at(2026, 8, 28, 9, 41)); db.commit()
check("Shivam (no punch) is nudged", "BX001:2026-08-28" in keys, True)
check("Nikunj (punched 09:05) is not", "BX003:2026-08-28" in keys, False)
check("Daksh with no login still alerts his manager", "BX002:2026-08-28" in keys, True)
check("Shivam got the nudge", len(notes(shivam_u, "attendance_late")), 1)
check("his manager was told", len(notes(himesh_u, "attendance_late", "Shivam")), 1)
keys = run_late_alerts(db, org, at(2026, 8, 28, 9, 55)); db.commit()
check("a later tick repeats nobody", "BX001:2026-08-28" in keys, False)
check("Shivam still has exactly one nudge", len(notes(shivam_u, "attendance_late")), 1)

print("3. Late alert stays silent when silence is correct")
db.add(Holiday(id=uuid.uuid4(), org_id=org.id, day=date(2026, 9, 1), name="Test Holiday"))
db.add(LeaveRequest(id=uuid.uuid4(), org_id=org.id, employee_id=shivam.id,
                    leave_type_id=EL.id, from_date=date(2026, 9, 2),
                    to_date=date(2026, 9, 2), status=LeaveStatus.APPROVED,
                    days_consumed=1, period="2026"))
db.add(LeaveRequest(id=uuid.uuid4(), org_id=org.id, employee_id=daksh.id,
                    leave_type_id=EL.id, from_date=date(2026, 9, 2),
                    to_date=date(2026, 9, 2), half_day_start=True,
                    status=LeaveStatus.APPROVED, days_consumed=0.5, period="2026"))
db.commit()
check("holiday: nobody is late", run_late_alerts(db, org, at(2026, 9, 1, 9, 41)), [])
keys = run_late_alerts(db, org, at(2026, 9, 2, 9, 41)); db.commit()
check("full-day approved leave silences Shivam", "BX001:2026-09-02" in keys, False)
check("HALF-day leave silences Daksh too", "BX002:2026-09-02" in keys, False)
check("everyone else still fires that day", "BX003:2026-09-02" in keys, True)
check("Sunday: nobody is late", run_late_alerts(db, org, at(2026, 8, 30, 9, 41)), [])
check("after shift end: too late to be useful",
      run_late_alerts(db, org, at(2026, 8, 31, 19, 0)), [])

print("4. Punch-out nudge: after shift end, only for an open pair, then expires")
punch(karan, at(2026, 8, 28, 18, 5), PunchDirection.OUT)
keys = run_punch_out_nudges(db, org, at(2026, 8, 28, 7, 0)); db.commit()
check("Tanvi's Wednesday pair has expired by Friday 07:00",
      "BX005:2026-08-27" in keys, False)
keys = run_punch_out_nudges(db, org, at(2026, 8, 28, 5, 0)); db.commit()
check("...but inside the 12h window it fires", "BX005:2026-08-27" in keys, True)
keys = run_punch_out_nudges(db, org, at(2026, 8, 28, 18, 29)); db.commit()
check("18:29 is before the 18:30 due time", "BX003:2026-08-28" in keys, False)
keys = run_punch_out_nudges(db, org, at(2026, 8, 28, 18, 31)); db.commit()
check("Nikunj (in, never out) is nudged", "BX003:2026-08-28" in keys, True)
check("Karan (in AND out) is not", "BX004:2026-08-28" in keys, False)
check("Shivam (no punches at all) is not", "BX001:2026-08-28" in keys, False)
check("Nikunj got the message", len(notes(nikunj_u, "attendance_punch_out")), 1)
keys = run_punch_out_nudges(db, org, at(2026, 8, 28, 18, 45)); db.commit()
check("a later tick repeats nobody", keys, [])

print("5. Night shift: Ritesh's 22:00-06:00 files against the right day")
keys = run_late_alerts(db, org, at(2026, 8, 28, 22, 45)); db.commit()
check("late alert due at 22:40, and only for him", keys, ["BX007:2026-08-28"])
punch(ritesh, at(2026, 8, 28, 23, 50), PunchDirection.IN)
keys = run_punch_out_nudges(db, org, at(2026, 8, 29, 6, 45)); db.commit()
check("morning-after nudge names YESTERDAY's shift date", keys, ["BX007:2026-08-28"])

print("6. tick() is safe at any frequency")
before_runs = len(db.scalars(select(ScheduledJobRun)).all())
s = tick(db, at(2026, 9, 3, 9, 41))
check("first tick of September runs the accrual too",
      "monthly_accrual" in s["jobs"], True)
check("no job errored", s["errors"], {})
after_first = len(db.scalars(select(ScheduledJobRun)).all())
check("the tick did real work", after_first > before_runs, True)
notes_after_first = len(db.scalars(select(Notification)).all())
for _ in range(4):
    s = tick(db, at(2026, 9, 3, 9, 41))
    check("repeat tick errors", s["errors"], {})
check("four more ticks add zero job runs",
      len(db.scalars(select(ScheduledJobRun)).all()), after_first)
check("...and zero notifications",
      len(db.scalars(select(Notification)).all()), notes_after_first)

print()
print("ALL PASS" if ok else "FAILURES - read above")
sys.exit(0 if ok else 1)
