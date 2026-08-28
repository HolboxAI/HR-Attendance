"""Run: python3 tests/test_register_device.py

POST /mobile/register-device: binding a handset to yourself outside of login.

Exists because the dashboard's check-in page had no exit from "this phone is
not registered" - dashboard sessions deliberately carry no install id, so
the only path to a binding was the phone's login flow or HR. Same rules as
login's binding, verified here: one handset per person, conflicts refused
with the same wording, HR's clear still frees the slot.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-regdev-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")
os.environ["FACE_PROVIDER"] = "stub"

from fastapi.testclient import TestClient                      # noqa: E402
from sqlalchemy import select                                  # noqa: E402

from app.core.security import hash_password                    # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.main import app                                       # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import UserRole                          # noqa: E402
from app.models.face import MobileDevice                       # noqa: E402
from app.models.org import Location, Organization              # noqa: E402

PW = "a-test-only-passphrase"
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
db.add(loc); db.commit()


def make(code, name, role=UserRole.EMPLOYEE, employee=True):
    e = None
    if employee:
        e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                     email=f"{name.lower()}@test.local", location_id=loc.id)
        db.add(e); db.commit()
    db.add(User(id=uuid.uuid4(), org_id=org.id,
                employee_id=e.id if e else None,
                email=f"{name.lower()}@test.local",
                password_hash=hash_password(PW), role=role))
    db.commit()
    return e


krish = make("BX001", "Krish", UserRole.SUPER_ADMIN)
daksh = make("BX004", "Daksh")
make("AUDIT", "Auditor", UserRole.HR_ADMIN, employee=False)

client = TestClient(app)


def token(name):
    r = client.post("/api/v1/auth/login",
                    json={"email": f"{name}@test.local", "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


KRISH, DAKSH, AUDIT = token("krish"), token("daksh"), token("auditor")


def register(headers, install, platform="web"):
    return client.post("/api/v1/mobile/register-device",
                       headers=headers | {"X-Install-Id": install},
                       json={"platform": platform})


print("1. Basics")
check("no token refused", client.post(
    "/api/v1/mobile/register-device", json={}).status_code, 401)
r = client.post("/api/v1/mobile/register-device", headers=KRISH, json={})
check("no install id is 422", r.status_code, 422)
check("...and says which header", "X-Install-Id" in r.json()["detail"], True)
check("a login with no employee record cannot bind",
      register(AUDIT, "auditor-browser").status_code, 403)

print("2. Binding this browser to yourself")
r = register(KRISH, "krish-browser-1")
check("bound", r.status_code, 200)
check("names the employee", r.json()["employee_code"], "BX001")
db.expire_all()
row = db.scalar(select(MobileDevice).where(MobileDevice.install_id == "krish-browser-1"))
check("row exists and active", row is not None and row.is_active, True)
check("belongs to Krish", row.employee_id, krish.id)
check("re-registering the same device is a no-op 200",
      register(KRISH, "krish-browser-1").status_code, 200)
check("still exactly one active binding", len(db.scalars(select(MobileDevice).where(
    MobileDevice.employee_id == krish.id, MobileDevice.is_active.is_(True))).all()), 1)

print("3. The one-handset rule holds here exactly as at login")
r = register(KRISH, "krish-browser-2")
check("a second device refused", r.status_code, 409)
check("same wording as login", "different phone" in r.json()["detail"], True)
r = register(DAKSH, "krish-browser-1")
check("someone else's device refused", r.status_code, 409)
check("does not say whose it is", "another employee" in r.json()["detail"]
      and "Krish" not in r.json()["detail"], True)

print("4. HR clearing still frees the slot")
check("clear", client.delete("/api/v1/admin/devices/BX001",
                             headers=AUDIT).status_code, 200)
check("new device now binds", register(KRISH, "krish-browser-2").status_code, 200)
check("a retired device can be claimed by its next owner",
      register(DAKSH, "krish-browser-1").status_code, 200)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
