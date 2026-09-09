"""Run: python3 tests/test_employees.py

Employee administration: hire, edit, offboard, re-issue a password.

The gap this closes: until now the only way to add a person was to edit
scripts/seed.py and run it, which the PRD's definition of done rules out ("HR
can manage employees ... without direct database access").

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-employees-"))
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
from app.models.attendance import ShiftAssignment, ShiftTemplate   # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import UserRole                          # noqa: E402
from app.models.face import FaceEnrollment, MobileDevice       # noqa: E402
from app.models.leave import AuditLog                          # noqa: E402
from app.models.notification import Notification               # noqa: E402
from app.models.org import Department, Location, Organization  # noqa: E402

PW = "a-test-only-passphrase"
ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    return good


Base.metadata.create_all(engine)
db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org); db.commit()
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office")
db.add(loc); db.commit()
eng = Department(id=uuid.uuid4(), org_id=org.id, name="Engineering")
db.add(eng); db.commit()
shift = ShiftTemplate(
    id=uuid.uuid4(), org_id=org.id, name="General",
    start_time=time(9, 30), end_time=time(18, 30), break_minutes=60,
    grace_minutes=15, half_day_after_minutes=240, full_day_after_minutes=450,
    cutover_hour=5, working_days=[0, 1, 2, 3, 4],
)
db.add(shift); db.commit()


def make(code, name, role):
    e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                 email=f"{name.lower()}@test.local", location_id=loc.id)
    db.add(e); db.commit()
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=e.id, email=e.email,
                password_hash=hash_password(PW), role=role))
    db.commit()
    return e


krish = make("BX001", "Krish", UserRole.SUPER_ADMIN)
himesh = make("BX008", "Himesh", UserRole.HR_ADMIN)
daksh = make("BX004", "Daksh", UserRole.EMPLOYEE)

client = TestClient(app)


def token(emp):
    r = client.post("/api/v1/auth/login", json={"email": emp.email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


KRISH, HIMESH, DAKSH = token(krish), token(himesh), token(daksh)


print("1. Only HR and above can create anyone")
check("employee refused", client.post("/api/v1/admin/employees", json={
    "emp_code": "BX099", "full_name": "Nope", "email": "nope@test.local",
}, headers=DAKSH).status_code, 403)
check("no token refused", client.post("/api/v1/admin/employees", json={
    "emp_code": "BX099", "full_name": "Nope", "email": "nope@test.local",
}).status_code, 401)


print("2. HR hires someone")
r = client.post("/api/v1/admin/employees", json={
    "emp_code": "bx012", "full_name": "  Priya  ", "email": "PRIYA@Test.Local",
    "department": "Engineering", "designation": "Engineer", "shift": "General",
    "manager_code": "BX008", "date_of_joining": "2026-09-01",
}, headers=HIMESH)
check("created", r.status_code, 201)
body = r.json()
check("code upper-cased", body["employee"]["emp_code"], "BX012")
check("name trimmed", body["employee"]["full_name"], "Priya")
check("email lower-cased", body["employee"]["email"], "priya@test.local")
check("department linked", body["employee"]["department"], "Engineering")
check("manager linked", body["employee"]["manager_code"], "BX008")
check("role defaults to employee", body["employee"]["role"], "employee")
check("has a login", body["employee"]["has_login"], True)

print("3. The temporary password is real, returned once, and never stored raw")
pw = body["temporary_password"]
check("password returned", bool(pw and len(pw) > 8), True)
priya = db.scalar(select(Employee).where(Employee.emp_code == "BX012"))
user = db.scalar(select(User).where(User.employee_id == priya.id))
check("stored hashed, not plain", user.password_hash != pw, True)
check("the new hire can actually sign in", client.post(
    "/api/v1/auth/login", json={"email": "priya@test.local", "password": pw}
).status_code, 200)
check("fetching them again does NOT leak it",
      "temporary_password" not in client.get(
          "/api/v1/admin/employees/BX012", headers=HIMESH).json(), True)

print("4. Onboarding side effects")
db.expire_all()
check("shift assigned", db.scalar(select(ShiftAssignment).where(
    ShiftAssignment.employee_id == priya.id)) is not None, True)
notes = db.scalars(select(Notification).where(Notification.user_id == user.id)).all()
check("invite notification written", len(notes), 1)
check("invite category", notes[0].category, "employee_invite")
audits = db.scalars(select(AuditLog).where(AuditLog.entity_id == priya.id)).all()
check("creation audited", any(a.action == "created" for a in audits), True)
check("audit names the actor", audits[0].actor_label, himesh.email)

print("5. Duplicates are refused, not silently merged")
dup = client.post("/api/v1/admin/employees", json={
    "emp_code": "BX012", "full_name": "Someone Else", "email": "other@test.local",
}, headers=HIMESH)
check("duplicate code refused", dup.status_code, 409)
check("says which code", "BX012" in dup.json()["detail"], True)
dup2 = client.post("/api/v1/admin/employees", json={
    "emp_code": "BX013", "full_name": "Someone Else", "email": "priya@test.local",
}, headers=HIMESH)
check("duplicate email refused", dup2.status_code, 409)
check("still only one BX012", len(db.scalars(select(Employee).where(
    Employee.emp_code == "BX012")).all()), 1)

print("6. Unknown department, shift or manager fails loudly")
for field, value, word in [("department", "Marketing", "department"),
                           ("shift", "Graveyard", "shift"),
                           ("manager_code", "BX999", "BX999")]:
    r = client.post("/api/v1/admin/employees",
                    json={"emp_code": "BX050", "full_name": "X",
                          "email": "x@test.local", field: value},
                    headers=HIMESH)
    check(f"bad {field} refused", r.status_code, 409)
    check(f"bad {field} explained", word.lower() in r.json()["detail"].lower(), True)

print("7. Admins can create admins, employees cannot")
r = client.post("/api/v1/admin/employees", json={
    "emp_code": "BX014", "full_name": "Sneaky", "email": "sneaky@test.local",
    "role": "hr_admin",
}, headers=DAKSH)
check("employee cannot create an admin", r.status_code, 403)
r = client.post("/api/v1/admin/employees", json={
    "emp_code": "BX014", "full_name": "Legit", "email": "legit@test.local",
    "role": "hr_admin",
}, headers=HIMESH)
check("admin can create an admin", r.status_code, 201)
check("role applied", r.json()["employee"]["role"], "hr_admin")

print("8. Editing records old and new")
r = client.patch("/api/v1/admin/employees/BX012",
                 json={"designation": "Senior Engineer", "phone": "+919000000000"},
                 headers=HIMESH)
check("patched", r.status_code, 200)
check("designation changed", r.json()["designation"], "Senior Engineer")
db.expire_all()
edit = db.scalars(select(AuditLog).where(
    AuditLog.entity_id == priya.id, AuditLog.action == "updated")).all()
check("edit audited", len(edit), 1)
check("old value kept", edit[0].changes["designation"]["old"], "Engineer")
check("new value kept", edit[0].changes["designation"]["new"], "Senior Engineer")

print("9. Changing the email moves the login with it")
r = client.patch("/api/v1/admin/employees/BX012",
                 json={"email": "priya.n@test.local"}, headers=HIMESH)
check("patched", r.status_code, 200)
check("old address no longer signs in", client.post(
    "/api/v1/auth/login",
    json={"email": "priya@test.local", "password": pw}).status_code, 401)
check("new address does", client.post(
    "/api/v1/auth/login",
    json={"email": "priya.n@test.local", "password": pw}).status_code, 200)
check("taken email refused", client.patch(
    "/api/v1/admin/employees/BX012", json={"email": "daksh@test.local"},
    headers=HIMESH).status_code, 409)

print("10. Role changes are admin only, and never your own")
check("employee cannot change role", client.patch(
    "/api/v1/admin/employees/BX012", json={"role": "hr_admin"},
    headers=DAKSH).status_code, 403)
check("admin Himesh can change role", client.patch(
    "/api/v1/admin/employees/BX012", json={"role": "hr_admin"},
    headers=HIMESH).status_code, 200)
check("admin Krish can change role", client.patch(
    "/api/v1/admin/employees/BX012", json={"role": "manager"},
    headers=KRISH).status_code, 200)
own = client.patch("/api/v1/admin/employees/BX001", json={"role": "employee"},
                   headers=KRISH)
check("cannot change own role", own.status_code, 409)
check("reason says so", "your own role" in own.json()["detail"].lower(), True)

print("11. Nobody can report to themselves")
loop = client.patch("/api/v1/admin/employees/BX012",
                    json={"manager_code": "BX012"}, headers=HIMESH)
check("self-management refused", loop.status_code, 409)

print("12. Offboarding disables, never deletes")
db.add(MobileDevice(id=uuid.uuid4(), employee_id=priya.id,
                    install_id="phone-1", platform="ios", is_active=True))
db.add(FaceEnrollment(id=uuid.uuid4(), org_id=org.id, employee_id=priya.id,
                      photo_key="enrolments/x/v1.jpg", is_active=True))
db.commit()

r = client.post("/api/v1/admin/employees/BX012/deactivate",
                json={"date_of_exit": "2026-09-30"}, headers=HIMESH)
check("deactivated", r.status_code, 200)
check("marked inactive", r.json()["is_active"], False)
check("exit date recorded", r.json()["date_of_exit"], "2026-09-30")

db.expire_all()
check("employee row still exists", db.scalar(select(Employee).where(
    Employee.emp_code == "BX012")) is not None, True)
check("login disabled", db.scalar(select(User).where(
    User.employee_id == priya.id)).is_active, False)
check("cannot sign in any more", client.post(
    "/api/v1/auth/login",
    json={"email": "priya.n@test.local", "password": pw}).status_code, 403)
check("phone unbound", db.scalar(select(MobileDevice).where(
    MobileDevice.employee_id == priya.id, MobileDevice.is_active.is_(True))) is None, True)
check("enrolment retired", db.scalar(select(FaceEnrollment).where(
    FaceEnrollment.employee_id == priya.id, FaceEnrollment.is_active.is_(True))) is None, True)
check("enrolment row kept for the audit trail", db.scalar(select(FaceEnrollment).where(
    FaceEnrollment.employee_id == priya.id)) is not None, True)
check("deactivation audited", db.scalar(select(AuditLog).where(
    AuditLog.entity_id == priya.id, AuditLog.action == "deactivated")) is not None, True)

print("13. Offboarding guards")
check("twice is refused", client.post(
    "/api/v1/admin/employees/BX012/deactivate", json={}, headers=HIMESH).status_code, 409)
check("cannot deactivate yourself", client.post(
    "/api/v1/admin/employees/BX008/deactivate", json={}, headers=HIMESH).status_code, 409)
check("unknown code is 404", client.post(
    "/api/v1/admin/employees/BX999/deactivate", json={}, headers=HIMESH).status_code, 404)

print("14. Re-issuing a password")
r = client.post("/api/v1/admin/employees/BX004/reset-password", headers=HIMESH)
check("issued", r.status_code, 200)
fresh = r.json()["temporary_password"]
check("differs from the old one", fresh != PW, True)
check("old password stops working", client.post(
    "/api/v1/auth/login",
    json={"email": daksh.email, "password": PW}).status_code, 401)
check("new one works", client.post(
    "/api/v1/auth/login",
    json={"email": daksh.email, "password": fresh}).status_code, 200)
check("employee cannot reset anyone", client.post(
    "/api/v1/admin/employees/BX001/reset-password", headers=DAKSH).status_code, 403)

print("15. Listing is scoped, and leavers are hidden by default")
rows = client.get("/api/v1/admin/employees", headers=HIMESH).json()
codes = {e["emp_code"] for e in rows}
check("HR sees active people", "BX004" in codes, True)
check("leaver hidden by default", "BX012" not in codes, True)
withall = client.get("/api/v1/admin/employees?include_inactive=true", headers=HIMESH).json()
check("leaver visible when asked", "BX012" in {e["emp_code"] for e in withall}, True)
check("employee cannot list", client.get(
    "/api/v1/admin/employees", headers=DAKSH).status_code, 403)
check("unknown code is 404", client.get(
    "/api/v1/admin/employees/BX999", headers=HIMESH).status_code, 404)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
