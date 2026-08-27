"""Run: python3 tests/test_auth.py

Each numbered group below is one line of the "Definition of done" checklist in
docs/AUTH-BRIEF.md, in order, so the output can be read straight against it.

Uses a throwaway SQLite file and uploads directory; never touches
data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-auth-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from fastapi.testclient import TestClient                      # noqa: E402
from sqlalchemy import select                                  # noqa: E402

from app.core.config import settings                           # noqa: E402
from app.core.office import OFFICE                              # noqa: E402
from app.core.security import hash_password                    # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.main import app                                       # noqa: E402
from app.models.attendance import PunchEvent                   # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import UserRole                           # noqa: E402
from app.models.org import Organization                        # noqa: E402
from app.services.storage import storage                       # noqa: E402

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
# From the office config, never a literal copy - see the same note in
# test_enrolment.py. A hardcoded pair silently turns "is this punch
# authorised" into "is this punch inside the geofence" the day the office
# moves, and the failure names the wrong thing entirely.
AT_OFFICE = {
    "lat": str(OFFICE["lat"]),
    "lng": str(OFFICE["lng"]),
    "accuracy_m": "12",
}
PW = "correct-horse-battery-staple"

ok = True
_ticks: dict[str, bool] = {}


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    return good


def box(item: str, passed: bool):
    _ticks[item] = _ticks.get(item, True) and passed


Base.metadata.create_all(engine)
storage.root = TMP / "uploads"
storage.root.mkdir(parents=True, exist_ok=True)

db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org)
db.commit()


def make(code, name, role, manager=None):
    emp = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                   email=f"{name.lower()}@test.local",
                   manager_id=manager.id if manager else None)
    db.add(emp)
    db.commit()
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=emp.id,
                email=emp.email, password_hash=hash_password(PW), role=role))
    db.commit()
    return emp


krish = make("BX001", "Krish", UserRole.SUPER_ADMIN)
ashley = make("BX006", "Ashley", UserRole.HR_ADMIN)
maya = make("BX008", "Maya", UserRole.MANAGER)
nikunj = make("BX002", "Nikunj", UserRole.EMPLOYEE, manager=maya)
ritesh = make("BX007", "Ritesh", UserRole.EMPLOYEE)

client = TestClient(app)


def login(emp, install_id=None, password=PW):
    body = {"email": emp.email, "password": password}
    if install_id:
        body |= {"install_id": install_id, "platform": "ios", "device_model": "iPhone"}
    return client.post("/api/v1/auth/login", json=body)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def punch(token, install_id, extra=None):
    headers = auth(token)
    if install_id:
        headers["X-Install-Id"] = install_id
    return client.post(
        "/api/v1/mobile/punch",
        files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
        data={**AT_OFFICE, **(extra or {})},
        headers=headers,
    )


# ---------------------------------------------------------------------------
print("1. A punch with no token is refused")
r = punch(None, "phone-krish") if False else client.post(
    "/api/v1/mobile/punch",
    files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
    data=AT_OFFICE,
)
box("punch-without-token-refused", check("no Authorization header -> 401", r.status_code, 401))
r2 = client.get("/api/v1/mobile/me")
box("punch-without-token-refused", check("/mobile/me also 401", r2.status_code, 401))
r3 = client.post(
    "/api/v1/mobile/punch",
    files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
    data=AT_OFFICE,
    headers={"Authorization": "Bearer not-a-real-token"},
)
box("punch-without-token-refused", check("garbage token -> 401", r3.status_code, 401))
before = len(db.scalars(select(PunchEvent)).all())
box("punch-without-token-refused", check("nothing was written", before, 0))


print("2. A punch cannot name a different employee")
schema = app.openapi()
ref = schema["paths"]["/api/v1/mobile/punch"]["post"]["requestBody"]["content"][
    "multipart/form-data"]["schema"]["$ref"].split("/")[-1]
fields = set(schema["components"]["schemas"][ref]["properties"])
box("no-employee-parameter", check("employee_code is not a punch parameter",
                                   "employee_code" in fields, False))

k_login = login(krish, "phone-krish").json()
k_token = k_login["access_token"]
# Send it anyway, the way an attacker with the old curl command would.
r = punch(k_token, "phone-krish", extra={"employee_code": ritesh.emp_code})
box("no-employee-parameter", check("smuggled employee_code accepted but ignored",
                                   r.status_code, 200))
db.expire_all()
ev = db.scalars(select(PunchEvent).order_by(PunchEvent.received_ts_utc.desc())).first()
box("no-employee-parameter", check("punch recorded against the TOKEN's employee",
                                   ev.employee_id, krish.id))
box("no-employee-parameter", check("not against the smuggled one",
                                   ev.employee_id != ritesh.id, True))


print("3. An employee token cannot reach any admin endpoint")
n_token = login(nikunj, "phone-nikunj").json()["access_token"]
admin_endpoints = [
    ("GET", "/api/v1/admin/board"),
    ("GET", "/api/v1/admin/rejected"),
    ("GET", "/api/v1/admin/month?employee_code=BX001&year=2026&month=8"),
    ("GET", "/api/v1/admin/enrolments"),
    ("GET", "/api/v1/admin/devices"),
    ("POST", "/api/v1/admin/correct"),
    ("DELETE", "/api/v1/admin/devices/BX001"),
]
for method, path in admin_endpoints:
    r = client.request(method, path, headers=auth(n_token), json={} if method == "POST" else None)
    box("employee-cannot-reach-admin",
        check(f"{method} {path.split('?')[0]} -> 403", r.status_code, 403))


print("4. An admin token CAN still punch - admins are employees too")
a_token = login(ashley, "phone-ashley").json()["access_token"]
for who, token, install in (("super_admin Krish", k_token, "phone-krish"),
                            ("hr_admin Ashley", a_token, "phone-ashley")):
    r = punch(token, install)
    body = r.json()
    box("admin-can-punch", check(f"{who} punch accepted", body.get("accepted"), True))
r = client.get("/api/v1/mobile/me", headers=auth(a_token))
box("admin-can-punch", check("admin can read their own day", r.status_code, 200))
box("admin-can-punch", check("and it is their own record",
                             r.json()["employee_code"], ashley.emp_code))


print("5. A manager sees their own reports and not the whole company")
m_token = login(maya, "phone-maya").json()["access_token"]
r = client.get("/api/v1/admin/board", headers=auth(m_token))
codes = {row["employee_code"] for row in r.json()["rows"]}
box("manager-scoped", check("board reachable", r.status_code, 200))
box("manager-scoped", check("sees their report Nikunj", nikunj.emp_code in codes, True))
box("manager-scoped", check("sees themselves", maya.emp_code in codes, True))
box("manager-scoped", check("does NOT see Ritesh", ritesh.emp_code in codes, False))
box("manager-scoped", check("does NOT see the whole company", len(codes), 2))
r = client.get(f"/api/v1/admin/month?employee_code={ritesh.emp_code}&year=2026&month=8",
               headers=auth(m_token))
box("manager-scoped", check("cannot pull an outsider's month", r.status_code, 404))
r = client.get(f"/api/v1/admin/month?employee_code={nikunj.emp_code}&year=2026&month=8",
               headers=auth(m_token))
box("manager-scoped", check("can pull their own report's month", r.status_code, 200))
r = client.get("/api/v1/admin/rejected", headers=auth(m_token))
box("manager-scoped", check("manager is still not HR (rejected -> 403)", r.status_code, 403))
r = client.get("/api/v1/admin/board", headers=auth(a_token))
box("manager-scoped", check("HR sees everyone", len(r.json()["rows"]), 5))


print("6. Exactly one login form; no separate admin credential")
paths = set(schema["paths"])
login_paths = {p for p in paths if "login" in p or "signin" in p or "register" in p}
box("one-login", check("exactly one login endpoint", login_paths, {"/api/v1/auth/login"}))
box("one-login", check("no signup endpoint",
                       any("register" in p or "signup" in p for p in paths), False))
# The same endpoint, the same body shape, for every role.
for who, emp in (("employee", nikunj), ("manager", maya),
                 ("hr_admin", ashley), ("super_admin", krish)):
    r = login(emp)
    box("one-login", check(f"{who} logs in at the same endpoint", r.status_code, 200))
    box("one-login", check(f"{who} identity reports can_punch",
                           r.json()["identity"]["can_punch"], True))
box("one-login", check("employee identity is not admin",
                       login(nikunj).json()["identity"]["is_admin"], False))
box("one-login", check("hr_admin identity is admin",
                       login(ashley).json()["identity"]["is_admin"], True))
box("one-login", check("wrong password refused", login(nikunj, password="nope").status_code, 401))
box("one-login", check("unknown email refused, same message",
                       client.post("/api/v1/auth/login",
                                   json={"email": "nobody@test.local", "password": PW}
                                   ).json()["detail"],
                       "Email or password is incorrect"))


print("7. (dashboard redirect - verified in the browser, see the notes below)")


print("8. Closing and reopening the app does not require a password")
session = login(ritesh, "phone-ritesh").json()
stored_refresh = session["refresh_token"]          # what expo-secure-store keeps
# Simulate a cold start: the access token is gone, only the refresh survives.
r = client.post("/api/v1/auth/refresh", json={"refresh_token": stored_refresh})
box("reopen-without-password", check("refresh returns a new session", r.status_code, 200))
new_access = r.json()["access_token"]
box("reopen-without-password", check("new access token works",
                                     client.get("/api/v1/mobile/me",
                                                headers=auth(new_access)).status_code, 200))
box("reopen-without-password", check("refresh tokens rotate",
                                     r.json()["refresh_token"] != stored_refresh, True))
box("reopen-without-password", check("the old refresh token is now dead",
                                     client.post("/api/v1/auth/refresh",
                                                 json={"refresh_token": stored_refresh}
                                                 ).status_code, 401))
# An access token must not be usable as a refresh token, or the short lifetime
# means nothing.
box("reopen-without-password", check("access token rejected at /refresh",
                                     client.post("/api/v1/auth/refresh",
                                                 json={"refresh_token": new_access}
                                                 ).status_code, 401))
r_refresh = r.json()["refresh_token"]
box("reopen-without-password", check("logout kills the session",
                                     client.post("/api/v1/auth/logout",
                                                 json={"refresh_token": r_refresh}
                                                 ).status_code, 200))
box("reopen-without-password", check("and it cannot be refreshed after",
                                     client.post("/api/v1/auth/refresh",
                                                 json={"refresh_token": r_refresh}
                                                 ).status_code, 401))


print("9. An unbound phone is refused, and HR can clear a binding")
box("device-binding", check("binding is on", settings.require_device_binding, True))
r = punch(k_token, None)
box("device-binding", check("punch with no install id -> 403", r.status_code, 403))
r = punch(k_token, "some-phone-nobody-registered")
box("device-binding", check("punch from an unknown phone -> 403", r.status_code, 403))
r = punch(k_token, "phone-ashley")
box("device-binding", check("punch from someone else's phone -> 403", r.status_code, 403))
r = login(krish, "a-completely-new-handset")
box("device-binding", check("second handset refused at login -> 409", r.status_code, 409))

r = client.delete(f"/api/v1/admin/devices/{krish.emp_code}", headers=auth(a_token))
box("device-binding", check("HR clears the binding", r.status_code, 200))
box("device-binding", check("old phone's sessions signed out",
                            r.json()["sessions_signed_out"] >= 1, True))
box("device-binding", check("cleared phone can no longer punch",
                            punch(k_token, "phone-krish").status_code, 403))
r = login(krish, "a-completely-new-handset")
box("device-binding", check("new handset now binds", r.status_code, 200))
box("device-binding", check("and can punch",
                            punch(r.json()["access_token"], "a-completely-new-handset"
                                  ).json().get("accepted"), True))
box("device-binding", check("employee cannot clear their own binding",
                            client.delete(f"/api/v1/admin/devices/{nikunj.emp_code}",
                                          headers=auth(n_token)).status_code, 403))

print("   set-password, since a first-time invite runs through it")
r = client.post("/api/v1/auth/set-password", headers=auth(n_token),
                json={"current_password": PW, "new_password": "a-brand-new-passphrase"})
box("device-binding", check("password changed", r.status_code, 200))
box("device-binding", check("old password no longer works",
                            login(nikunj, password=PW).status_code, 401))
box("device-binding", check("new password works",
                            login(nikunj, password="a-brand-new-passphrase").status_code, 200))

db.close()

print("\n" + "=" * 62)
print("Definition of done - items this suite covers")
print("=" * 62)
LABELS = {
    "punch-without-token-refused": "A punch with no token is refused",
    "no-employee-parameter":       "A punch cannot name a different employee",
    "employee-cannot-reach-admin": "Employee token cannot reach admin endpoints",
    "admin-can-punch":             "An admin token CAN still punch",
    "manager-scoped":              "A manager sees only their own reports",
    "one-login":                   "Exactly one login form, no admin credential",
    "reopen-without-password":     "Reopening the app needs no password",
    "device-binding":              "Unbound phone refused; HR can clear a binding",
}
for key, label in LABELS.items():
    print(f"  [{'x' if _ticks.get(key) else ' '}] {label}")
print()
print("ALL PASS" if ok else "FAILURES ABOVE")
sys.exit(0 if ok else 1)
