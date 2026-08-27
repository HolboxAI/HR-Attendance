"""Run: python3 tests/test_leave.py

Each numbered group is one line of the "Definition of done" in
docs/LEAVE-BRIEF.md, so the output reads straight against it.

Throwaway SQLite file and uploads dir; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-leave-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
# Pinned, not inherited. Settings read apps/api/.env, so a developer with
# FACE_PROVIDER=rekognition configured would have these tests calling real
# AWS with synthetic images - billed, slow, offline-hostile, and failing for
# a reason that has nothing to do with the code under test.
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from fastapi.testclient import TestClient                      # noqa: E402
from sqlalchemy import select                                  # noqa: E402

from app.core.security import hash_password                    # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.main import app                                       # noqa: E402
from app.models.attendance import AttendanceDay, ShiftAssignment, ShiftTemplate  # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import (                                 # noqa: E402
    AccrualRule, LeaveStatus, PunchDirection, PunchSource, UserRole,
)
from app.models.leave import (                                 # noqa: E402
    AuditLog, Holiday, LeaveRequest, LeaveType,
)
from app.models.org import Location, Organization              # noqa: E402
from app.services import leave as leave_service                # noqa: E402
from app.services.attendance import recompute_day, record_punch  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
PW = "a-test-only-passphrase"

ok = True
_ticks: dict[str, bool] = {}


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    return good


def box(item, passed):
    _ticks[item] = _ticks.get(item, True) and passed


Base.metadata.create_all(engine)
db = SessionLocal()

org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org)
db.commit()
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office", lat=23.0315, lng=72.5298)
db.add(loc)
db.commit()

# Mon-Fri, so "leave across a weekend" has a weekend to cross.
shift = ShiftTemplate(
    id=uuid.uuid4(), org_id=org.id, name="General",
    start_time=time(9, 30), end_time=time(18, 30), break_minutes=60,
    grace_minutes=15, half_day_after_minutes=240, full_day_after_minutes=450,
    cutover_hour=5, working_days=[0, 1, 2, 3, 4],
)
db.add(shift)
db.commit()


def make(code, name, role):
    emp = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                   email=f"{name.lower()}@test.local", location_id=loc.id)
    db.add(emp)
    db.commit()
    db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=emp.id,
                           shift_template_id=shift.id, effective_from=date(2026, 1, 1)))
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=emp.id, email=emp.email,
                password_hash=hash_password(PW), role=role))
    db.commit()
    return emp


ashley = make("BX006", "Ashley", UserRole.HR_ADMIN)
maya = make("BX008", "Maya", UserRole.MANAGER)
nikunj = make("BX002", "Nikunj", UserRole.EMPLOYEE)
dhruv = make("BX005", "Dhruv", UserRole.EMPLOYEE)
nikunj.manager_id = maya.id
dhruv.manager_id = maya.id
db.commit()

for code, name, quota, rule, cf, cap, paid, order in [
    ("CL", "Casual Leave", 12, AccrualRule.MONTHLY, False, 0, True, 1),
    ("SL", "Sick Leave", 6, AccrualRule.MONTHLY, False, 0, True, 2),
    ("EL", "Earned Leave", 15, AccrualRule.MONTHLY, True, 30, True, 3),
    ("LOP", "Loss of Pay", 0, AccrualRule.NONE, False, 0, False, 9),
]:
    db.add(LeaveType(id=uuid.uuid4(), org_id=org.id, code=code, name=name,
                     annual_quota=quota, accrual_rule=rule, carries_forward=cf,
                     carry_cap=cap, is_paid=paid, sort_order=order))
db.commit()

EL = db.scalar(select(LeaveType).where(LeaveType.code == "EL"))
CL = db.scalar(select(LeaveType).where(LeaveType.code == "CL"))
LOP = db.scalar(select(LeaveType).where(LeaveType.code == "LOP"))

client = TestClient(app)


def token(emp):
    r = client.post("/api/v1/auth/login", json={"email": emp.email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


ASHLEY, MAYA, NIKUNJ, DHRUV = (token(e) for e in (ashley, maya, nikunj, dhruv))

# A settled week in the past: Mon 10 Aug 2026 .. Fri 14 Aug, weekend 15-16,
# Mon 17. All before today, so the shift has ended and an empty day is absent.
MON = date(2026, 8, 10)
WED = date(2026, 8, 12)
FRI = date(2026, 8, 14)
NEXT_MON = date(2026, 8, 17)
assert MON.weekday() == 0 and FRI.weekday() == 4 and NEXT_MON.weekday() == 0

# Give everyone something to spend: eight months of accrual.
for m in range(1, 9):
    leave_service.accrue_month(db, org_id=org.id, year=2026, month=m)
db.commit()

# Widen the backdating window so the test can book last week's dates. Doing it
# through the API doubles as proof the setting is read at runtime.
client.put("/api/v1/admin/leave/policy", headers=ASHLEY,
           json={"year_start_month": 1, "sandwich_rule": False, "backdate_days": 120})


def status_on(emp, day):
    db.expire_all()
    row = db.scalar(select(AttendanceDay).where(
        AttendanceDay.employee_id == emp.id, AttendanceDay.shift_date == day))
    return row.status.value if row else None


def apply_leave(headers, code, start, end, **kw):
    return client.post("/api/v1/leave/request", headers=headers, json={
        "leave_type_code": code, "from_date": start.isoformat(),
        "to_date": end.isoformat(), **kw,
    })


# ---------------------------------------------------------------------------
print("1. An approved leave day shows On leave, not Absent")
r = apply_leave(NIKUNJ, "EL", WED, WED, reason="Family thing")
box("leave-shows-on-leave", check("applied", r.status_code, 200))
req_id = r.json()["id"]
r = client.post(f"/api/v1/admin/leave/{req_id}/decide", headers=ASHLEY,
                json={"approve": True})
box("leave-shows-on-leave", check("approved", r.status_code, 200))
box("leave-shows-on-leave", check("day now reads on_leave", status_on(nikunj, WED), "on_leave"))
r = client.get(f"/api/v1/admin/board?on={WED.isoformat()}", headers=ASHLEY)
row = next(x for x in r.json()["rows"] if x["employee_code"] == nikunj.emp_code)
box("leave-shows-on-leave", check("board agrees", row["status"], "on_leave"))


print("2. A public holiday shows Holiday for everyone, not Absent")
HOL = date(2026, 8, 11)          # Tuesday
db.expire_all()
recompute_day(db, dhruv, HOL)
db.commit()
box("holiday-shows-holiday", check("absent before the holiday exists",
                                   status_on(dhruv, HOL), "absent"))
r = client.post("/api/v1/admin/holidays", headers=ASHLEY,
                json={"day": HOL.isoformat(), "name": "Test Holiday"})
box("holiday-shows-holiday", check("holiday added", r.status_code, 200))
for who in (nikunj, dhruv, maya, ashley):
    box("holiday-shows-holiday",
        check(f"{who.full_name} reads holiday", status_on(who, HOL), "holiday"))


print("3. Approving leave immediately updates days already computed as absent")
db.expire_all()
recompute_day(db, dhruv, MON)
db.commit()
box("approve-fixes-absent", check("absent to begin with", status_on(dhruv, MON), "absent"))
r = apply_leave(DHRUV, "EL", MON, MON)
rid = r.json()["id"]
client.post(f"/api/v1/admin/leave/{rid}/decide", headers=ASHLEY, json={"approve": True})
# Nothing else touched this date - the approval itself did the recompute.
box("approve-fixes-absent", check("now on_leave, with no other action",
                                  status_on(dhruv, MON), "on_leave"))


print("4. Cancelling leave puts those days back")
before = leave_service.balance(db, dhruv, EL, "2026").available
r = client.post(f"/api/v1/leave/{rid}/cancel", headers=DHRUV)
box("cancel-restores", check("cancelled", r.status_code, 200))
box("cancel-restores", check("status is cancelled, not deleted",
                             r.json()["status"], "cancelled"))
box("cancel-restores", check("day is absent again", status_on(dhruv, MON), "absent"))
db.expire_all()
box("cancel-restores", check("balance returned",
                             leave_service.balance(db, dhruv, EL, "2026").available,
                             before + 1.0))
kept = db.scalar(select(LeaveRequest).where(LeaveRequest.id == uuid.UUID(rid)))
box("cancel-restores", check("the row survives, it is not deleted", kept is not None, True))
box("cancel-restores", check("and remembers who approved it",
                             kept.approver_id is not None, True))


print("5. Applying for more than the balance is refused, with the balance shown")
db.expire_all()
avail = leave_service.balance(db, nikunj, CL, "2026").available
r = apply_leave(NIKUNJ, "CL", date(2026, 9, 1), date(2026, 10, 30))
box("over-balance-refused", check("refused", r.status_code, 409))
detail = r.json()["detail"]
box("over-balance-refused", check("says how many they have", f"{avail:g}" in detail, True))
box("over-balance-refused", check("names the type", "CL" in detail, True))
# Unpaid leave has no balance to exceed - that is the point of it.
r = apply_leave(NIKUNJ, "LOP", date(2026, 9, 1), date(2026, 9, 30))
box("over-balance-refused", check("unpaid leave is not balance-checked",
                                  r.status_code, 200))
client.post(f"/api/v1/leave/{r.json()['id']}/cancel", headers=NIKUNJ)


print("6. Two overlapping requests cannot both exist")
a = apply_leave(DHRUV, "EL", date(2026, 9, 7), date(2026, 9, 9))
box("no-overlap", check("first accepted", a.status_code, 200))
b = apply_leave(DHRUV, "EL", date(2026, 9, 9), date(2026, 9, 10))
box("no-overlap", check("overlapping refused", b.status_code, 409))
box("no-overlap", check("explains the clash", "already have" in b.json()["detail"], True))
c = apply_leave(DHRUV, "EL", date(2026, 9, 10), date(2026, 9, 11))
box("no-overlap", check("adjacent, non-overlapping is fine", c.status_code, 200))
for rr in (a, c):
    client.post(f"/api/v1/leave/{rr.json()['id']}/cancel", headers=DHRUV)


print("7. A punch on a leave day is flagged to HR, not silently swallowed")
r = apply_leave(NIKUNJ, "EL", FRI, FRI)
fid = r.json()["id"]
client.post(f"/api/v1/admin/leave/{fid}/decide", headers=ASHLEY, json={"approve": True})
db.expire_all()
for hh, mm in ((9, 30), (18, 30)):
    record_punch(db, org_id=org.id, employee=nikunj,
                 event_ts=datetime.combine(FRI, time(hh, mm), tzinfo=IST),
                 source=PunchSource.MOBILE_APP, direction=PunchDirection.UNKNOWN,
                 geofence_ok=True, face_ok=True)
db.commit()
recompute_day(db, nikunj, FRI)
db.commit()
db.expire_all()
day = db.scalar(select(AttendanceDay).where(
    AttendanceDay.employee_id == nikunj.id, AttendanceDay.shift_date == FRI))
box("punch-on-leave-flagged", check("still reads on_leave", day.status.value, "on_leave"))
box("punch-on-leave-flagged", check("flagged as an exception", day.has_exception, True))
box("punch-on-leave-flagged", check("note explains it",
                                    "leave" in (day.exception_note or "").lower(), True))
db.expire_all()
still = db.scalar(select(LeaveRequest).where(LeaveRequest.id == uuid.UUID(fid)))
box("punch-on-leave-flagged", check("the leave was NOT auto-cancelled",
                                    still.status.value, "approved"))


print("8. Leave across a weekend consumes only working days")
days = leave_service.days_for(db, dhruv, start=FRI, end=NEXT_MON,
                              half_day_start=False, half_day_end=False)
box("weekend-not-consumed", check("Fri->Mon costs 2 days, not 4", days, 2.0))
# Turn the sandwich rule on and the same range costs the weekend too.
client.put("/api/v1/admin/leave/policy", headers=ASHLEY,
           json={"year_start_month": 1, "sandwich_rule": True, "backdate_days": 120})
db.expire_all()
box("weekend-not-consumed",
    check("with sandwich on it costs 4",
          leave_service.days_for(db, dhruv, start=FRI, end=NEXT_MON,
                                 half_day_start=False, half_day_end=False), 4.0))
client.put("/api/v1/admin/leave/policy", headers=ASHLEY,
           json={"year_start_month": 1, "sandwich_rule": False, "backdate_days": 120})
db.expire_all()
box("weekend-not-consumed",
    check("and back to 2 when switched off",
          leave_service.days_for(db, dhruv, start=FRI, end=NEXT_MON,
                                 half_day_start=False, half_day_end=False), 2.0))
box("weekend-not-consumed",
    check("a holiday inside the range is free too",
          leave_service.days_for(db, dhruv, start=date(2026, 8, 10), end=date(2026, 8, 12),
                                 half_day_start=False, half_day_end=False), 2.0))
box("weekend-not-consumed",
    check("half day at the start costs 0.5 less",
          leave_service.days_for(db, dhruv, start=FRI, end=NEXT_MON,
                                 half_day_start=True, half_day_end=False), 1.5))


print("9. Running the accrual job twice does not double anyone's balance")
db.expire_all()
before = leave_service.balance(db, nikunj, EL, "2026").accrued
r1 = client.post("/api/v1/admin/leave/accrue?year=2026&month=9", headers=ASHLEY)
db.expire_all()
after_once = leave_service.balance(db, nikunj, EL, "2026").accrued
r2 = client.post("/api/v1/admin/leave/accrue?year=2026&month=9", headers=ASHLEY)
db.expire_all()
after_twice = leave_service.balance(db, nikunj, EL, "2026").accrued
box("accrual-idempotent", check("first run credits", after_once > float(before), True))
box("accrual-idempotent", check("second run changes nothing", after_twice, after_once))
box("accrual-idempotent", check("and reports it skipped", r2.json()["credited"], 0))
box("accrual-idempotent", check("skipped count is non-zero", r2.json()["skipped"] > 0, True))


print("10. An employee cannot approve their own leave - not even an admin")
r = apply_leave(ASHLEY, "EL", date(2026, 9, 21), date(2026, 9, 21))
own = r.json()["id"]
box("no-self-approval", check("hr_admin can apply", r.status_code, 200))
r = client.post(f"/api/v1/admin/leave/{own}/decide", headers=ASHLEY, json={"approve": True})
box("no-self-approval", check("but cannot decide it", r.status_code, 409))
box("no-self-approval", check("and is told why",
                              "your own" in r.json()["detail"].lower(), True))
q = client.get("/api/v1/admin/leave/pending", headers=ASHLEY).json()
box("no-self-approval", check("own request is not in own queue",
                              any(x["id"] == own for x in q), False))
r = apply_leave(NIKUNJ, "EL", date(2026, 9, 22), date(2026, 9, 22))
box("no-self-approval", check("an employee cannot decide at all",
                              client.post(f"/api/v1/admin/leave/{r.json()['id']}/decide",
                                          headers=NIKUNJ, json={"approve": True}
                                          ).status_code, 403))
box("no-self-approval", check("their manager can",
                              client.post(f"/api/v1/admin/leave/{r.json()['id']}/decide",
                                          headers=MAYA, json={"approve": True}
                                          ).status_code, 200))


print("11. hr_admin can change every leave setting from the dashboard")
r = client.put("/api/v1/admin/leave/policy", headers=ASHLEY, json={
    "year_start_month": 4, "sandwich_rule": True, "backdate_days": 30})
box("hr-can-edit-everything", check("leave year changed", r.json()["year_start_month"], 4))
box("hr-can-edit-everything", check("sandwich rule changed", r.json()["sandwich_rule"], True))
box("hr-can-edit-everything", check("backdating changed", r.json()["backdate_days"], 30))
db.expire_all()
box("hr-can-edit-everything", check("and it took effect with no restart",
                                    leave_service.period_for(
                                        leave_service.policy(db, org.id), date(2026, 8, 1)),
                                    "2026-27"))
client.put("/api/v1/admin/leave/policy", headers=ASHLEY, json={
    "year_start_month": 1, "sandwich_rule": False, "backdate_days": 120})

types = client.get("/api/v1/admin/leave/types", headers=ASHLEY).json()
el = next(t for t in types if t["code"] == "EL")
r = client.put(f"/api/v1/admin/leave/types/{el['id']}", headers=ASHLEY, json={
    **el, "annual_quota": 18, "carry_cap": 45, "carries_forward": True,
})
box("hr-can-edit-everything", check("quota changed", r.json()["annual_quota"], 18.0))
box("hr-can-edit-everything", check("carry-forward cap changed", r.json()["carry_cap"], 45.0))
r = client.put(f"/api/v1/admin/leave/types/{el['id']}", headers=ASHLEY, json={
    **el, "annual_quota": 18, "carry_cap": 45, "accrual_rule": "annual",
})
box("hr-can-edit-everything", check("accrual rule changed",
                                    r.json()["accrual_rule"], "annual"))
client.put(f"/api/v1/admin/leave/types/{el['id']}", headers=ASHLEY, json={
    **el, "annual_quota": 18, "carry_cap": 45})


print("12. A plain employee cannot reach the leave policy page or its endpoints")
locked = [
    ("GET", "/api/v1/admin/leave/policy", None),
    ("PUT", "/api/v1/admin/leave/policy",
     {"year_start_month": 1, "sandwich_rule": True, "backdate_days": 99}),
    ("GET", "/api/v1/admin/leave/types", None),
    ("GET", "/api/v1/admin/leave/audit", None),
    ("POST", "/api/v1/admin/leave/accrue?year=2026&month=10", None),
    ("POST", "/api/v1/admin/holidays", {"day": "2026-12-01", "name": "Nope"}),
]
for method, path, payload in locked:
    box("employee-locked-out",
        check(f"employee {method} {path.split('?')[0]} -> 403",
              client.request(method, path, headers=NIKUNJ, json=payload).status_code, 403))
# A manager is an approver, not an owner of the policy.
box("employee-locked-out", check("manager cannot edit policy either",
                                 client.get("/api/v1/admin/leave/policy",
                                            headers=MAYA).status_code, 403))
box("employee-locked-out", check("but hr_admin can", client.get(
    "/api/v1/admin/leave/policy", headers=ASHLEY).status_code, 200))
box("employee-locked-out", check("signed out is 401", client.get(
    "/api/v1/admin/leave/policy").status_code, 401))


print("13. Changing a quota does not alter balances already accrued")
db.expire_all()
accrued_before = float(leave_service.balance(db, nikunj, CL, "2026").accrued)
cl = next(t for t in client.get("/api/v1/admin/leave/types",
                                headers=ASHLEY).json() if t["code"] == "CL")
client.put(f"/api/v1/admin/leave/types/{cl['id']}", headers=ASHLEY,
           json={**cl, "annual_quota": 24})
db.expire_all()
box("quota-change-safe", check("balance untouched by the edit",
                               float(leave_service.balance(db, nikunj, CL, "2026").accrued),
                               accrued_before))
# It applies from the NEXT accrual run forward.
client.post("/api/v1/admin/leave/accrue?year=2026&month=10", headers=ASHLEY)
db.expire_all()
after = float(leave_service.balance(db, nikunj, CL, "2026").accrued)
box("quota-change-safe", check("next run uses the new quota (24/12 = 2)",
                               round(after - accrued_before, 2), 2.0))


print("14. Every policy change writes an audit row with old and new values")
db.expire_all()
rows = db.scalars(select(AuditLog).where(AuditLog.entity == "leave_type")).all()
# Pick by entity, not by timestamp: several edits happened in the same second
# and SQLite's now() has second resolution, so "most recent" is a coin flip.
quota_edits = [
    r for r in rows
    if "annual_quota" in (r.changes or {}) and str(r.entity_id) == cl["id"]
]
box("policy-audited", check("the CL quota edit was recorded", len(quota_edits), 1))
latest = quota_edits[0]
box("policy-audited", check("records the old value",
                            latest.changes["annual_quota"]["old"], 12.0))
box("policy-audited", check("records the new value",
                            latest.changes["annual_quota"]["new"], 24.0))
el_edits = [
    r for r in rows
    if "annual_quota" in (r.changes or {}) and str(r.entity_id) == el["id"]
]
box("policy-audited", check("the EL edit is a separate row", len(el_edits) >= 1, True))
box("policy-audited", check("with its own old value",
                            el_edits[0].changes["annual_quota"]["old"], 15.0))
box("policy-audited", check("and who did it", latest.actor_label, ashley.email))
box("policy-audited", check("and says balances are unaffected",
                            "unchanged" in (latest.note or "").lower(), True))
pol_rows = db.scalars(select(AuditLog).where(AuditLog.entity == "leave_policy")).all()
box("policy-audited", check("policy edits are audited too", len(pol_rows) > 0, True))
box("policy-audited", check("sandwich rule change captured old+new",
                            any("sandwich_rule" in (r.changes or {}) for r in pol_rows), True))
api_audit = client.get("/api/v1/admin/leave/audit", headers=ASHLEY).json()
box("policy-audited", check("HR can read the trail", len(api_audit) > 0, True))


print("15. Adding a holiday recomputes those dates; removing puts them back")
NEWHOL = date(2026, 8, 19)        # Wednesday
db.expire_all()
recompute_day(db, dhruv, NEWHOL)
db.commit()
box("holiday-recompute", check("absent first", status_on(dhruv, NEWHOL), "absent"))
r = client.post("/api/v1/admin/holidays", headers=ASHLEY,
                json={"day": NEWHOL.isoformat(), "name": "Extra Holiday"})
hid = r.json()["id"]
box("holiday-recompute", check("added", r.status_code, 200))
box("holiday-recompute", check("recomputed to holiday", status_on(dhruv, NEWHOL), "holiday"))
r = client.delete(f"/api/v1/admin/holidays/{hid}", headers=ASHLEY)
box("holiday-recompute", check("removed", r.status_code, 200))
box("holiday-recompute", check("recomputed back to absent",
                               status_on(dhruv, NEWHOL), "absent"))
db.expire_all()
gone = db.scalar(select(Holiday).where(Holiday.id == uuid.UUID(hid)))
box("holiday-recompute", check("soft-deleted, not destroyed", gone is not None, True))
box("holiday-recompute", check("duplicate date refused", client.post(
    "/api/v1/admin/holidays", headers=ASHLEY,
    json={"day": HOL.isoformat(), "name": "Again"}).status_code, 409))

db.close()

print("\n" + "=" * 64)
print("Definition of done - items this suite covers")
print("=" * 64)
LABELS = {
    "leave-shows-on-leave":   "Approved leave day shows On leave, not Absent",
    "holiday-shows-holiday":  "Public holiday shows Holiday for everyone",
    "approve-fixes-absent":   "Approving fixes days already computed as absent",
    "cancel-restores":        "Cancelling puts those days back",
    "over-balance-refused":   "Over-balance refused, with the balance shown",
    "no-overlap":             "Two overlapping requests cannot both exist",
    "punch-on-leave-flagged": "Punch on a leave day is flagged, not swallowed",
    "weekend-not-consumed":   "Leave across a weekend consumes only working days",
    "accrual-idempotent":     "Running accrual twice does not double balances",
    "no-self-approval":       "Nobody approves their own leave, admin included",
    "hr-can-edit-everything": "hr_admin changes every setting, no restart",
    "employee-locked-out":    "Employee cannot reach the policy endpoints",
    "quota-change-safe":      "Quota change does not alter accrued balances",
    "policy-audited":         "Every policy change audited with old + new",
    "holiday-recompute":      "Adding a holiday recomputes those dates",
}
for key, label in LABELS.items():
    print(f"  [{'x' if _ticks.get(key) else ' '}] {label}")
print()
print("ALL PASS" if ok else "FAILURES ABOVE")
sys.exit(0 if ok else 1)
