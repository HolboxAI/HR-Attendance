"""Run: python3 tests/test_location.py

Office location and presence policy, configurable at runtime.

The gap this closes: coordinates and radius already came from the database,
but the BSSID list and the policy were a Python constant, so registering an
access point meant editing code and restarting. The PRD requires presence
policy to be "changeable per location without code deployment".

Also the first super_admin-only surface in the system. Until now every gated
route topped out at hr_admin, so hr_admin and super_admin were identical.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-location-"))
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
from app.models.face import FaceEnrollment                     # noqa: E402
from app.models.leave import AuditLog                          # noqa: E402
from app.models.org import Location, Organization              # noqa: E402
from app.services.storage import storage                       # noqa: E402

PW = "a-test-only-passphrase"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
OFFICE_LAT, OFFICE_LNG = 23.03479, 72.53238
OFFICE_AP = "A4:2B:8C:11:03:F7"
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
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office",
               lat=OFFICE_LAT, lng=OFFICE_LNG, geofence_radius_m=200)
db.add(loc); db.commit()
shift = ShiftTemplate(
    id=uuid.uuid4(), org_id=org.id, name="General",
    start_time=time(9, 30), end_time=time(18, 30), break_minutes=60,
    grace_minutes=15, half_day_after_minutes=240, full_day_after_minutes=450,
    cutover_hour=5, working_days=[0, 1, 2, 3, 4, 5, 6],
)
db.add(shift); db.commit()


def make(code, name, role):
    e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                 email=f"{name.lower()}@test.local", location_id=loc.id)
    db.add(e); db.commit()
    db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=e.id,
                           shift_template_id=shift.id, effective_from=date(2020, 1, 1)))
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=e.id, email=e.email,
                password_hash=hash_password(PW), role=role))
    db.commit()
    return e


krish = make("BX001", "Krish", UserRole.SUPER_ADMIN)
himesh = make("BX008", "Himesh", UserRole.HR_ADMIN)
karan = make("BX011", "Karan", UserRole.EMPLOYEE)

# Karan needs a reference photo, or the punch stops before the geofence result
# is what we are measuring.
key = "enrolments/karan/v1.jpg"
storage.put(key, JPEG)
db.add(FaceEnrollment(id=uuid.uuid4(), org_id=org.id, employee_id=karan.id,
                      photo_key=key, is_active=True))
db.commit()

client = TestClient(app)


def token(emp, install=None):
    payload = {"email": emp.email, "password": PW}
    if install:
        payload |= {"install_id": install, "platform": "ios"}
    r = client.post("/api/v1/auth/login", json=payload)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


KRISH, HIMESH = token(krish), token(himesh)
KARAN = token(karan, "karan-phone")
KARAN_PUNCH = KARAN | {"X-Install-Id": "karan-phone"}


_punch_seq = [0]


def punch(lat, lng, bssid=None):
    # Each punch gets its own event second via captured_at, the offline-queue
    # timestamp the server accepts within bounds. Without this the whole
    # suite runs inside one wall-clock second, and same identity + same
    # second + same direction is the DEDUPE KEY - so every punch after the
    # first replays the first's stored verdict, which is correct behaviour
    # and useless for testing fifteen different geofence inputs. (This suite
    # used to pass anyway because the replay path rebuilt its answer from the
    # request instead of the stored row. That bug is fixed; this is the test
    # catching up.)
    from datetime import datetime, timedelta, timezone as _tz
    _punch_seq[0] += 1
    captured = datetime.now(_tz.utc) - timedelta(seconds=30 * _punch_seq[0])
    data = {"lat": str(lat), "lng": str(lng), "accuracy_m": "12",
            "direction": "in", "captured_at": captured.isoformat()}
    if bssid:
        data["wifi_bssid"] = bssid
    r = client.post("/api/v1/mobile/punch", headers=KARAN_PUNCH,
                    files={"selfie": ("s.jpg", JPEG, "image/jpeg")}, data=data)
    assert r.status_code == 200, r.text
    return r.json()


print("1. Reading it")
r = client.get("/api/v1/admin/location", headers=HIMESH)
check("hr_admin can read", r.status_code, 200)
body = r.json()
check("radius", body["radius_m"], 200)
check("defaults to wifi_or_gps", body["presence_policy"], "wifi_or_gps")
check("no access points yet", body["allowed_bssids"], [])
check("says GPS is carrying it", "GPS alone" in (body["note"] or ""), True)
check("wifi cannot be required yet", body["wifi_can_be_required"], False)
check("employee cannot read", client.get(
    "/api/v1/admin/location", headers=KARAN).status_code, 403)

print("2. Only a super admin may change it - the first such endpoint")
r = client.put("/api/v1/admin/location", json={"radius_m": 300}, headers=HIMESH)
check("hr_admin refused", r.status_code, 403)
check("employee refused", client.put(
    "/api/v1/admin/location", json={"radius_m": 300}, headers=KARAN).status_code, 403)
check("super_admin allowed", client.put(
    "/api/v1/admin/location", json={"radius_m": 300}, headers=KRISH).status_code, 200)

print("3. BSSIDs are validated and canonicalised on the way in")
bad = client.put("/api/v1/admin/location",
                 json={"allowed_bssids": ["not-a-mac"]}, headers=KRISH)
check("rubbish refused", bad.status_code, 422)
r = client.put("/api/v1/admin/location",
               json={"allowed_bssids": ["A4-2B-8C-11-03-F7", "a4:2b:8c:11:03:f7",
                                        "  B0:1C:2D:3E:4F:50  "]},
               headers=KRISH)
check("accepted", r.status_code, 200)
check("lower-cased, colonised, de-duplicated",
      r.json()["allowed_bssids"], ["a4:2b:8c:11:03:f7", "b0:1c:2d:3e:4f:50"])
check("wifi can now be required", r.json()["wifi_can_be_required"], True)

print("4. A registered access point actually changes the punch result")
# 2km away: GPS fails. On the office AP, wifi_or_gps still lets it through -
# which is the whole reason BSSID exists, since GPS cannot tell a 3rd floor
# from the lobby but an access point's range can.
far = punch(23.0195, 72.5290)
check("far away, no wifi -> refused", far["accepted"], False)
check("distance explained", "from the office" in far["message"], True)
near = punch(23.0195, 72.5290, bssid=OFFICE_AP)
check("far away but ON THE OFFICE AP -> accepted", near["accepted"], True)
check("an unknown AP does not help", punch(
    23.0195, 72.5290, bssid="ff:ff:ff:ff:ff:ff")["accepted"], False)

print("5. Switching policy takes effect with no restart")
check("gps_only set", client.put("/api/v1/admin/location",
      json={"presence_policy": "gps_only"}, headers=KRISH).status_code, 200)
check("under gps_only the AP is ignored",
      punch(23.0195, 72.5290, bssid=OFFICE_AP)["accepted"], False)

check("wifi_required set", client.put("/api/v1/admin/location",
      json={"presence_policy": "wifi_required"}, headers=KRISH).status_code, 200)
check("at the office but no AP -> refused",
      punch(OFFICE_LAT, OFFICE_LNG)["accepted"], False)
check("at the office ON the AP -> accepted",
      punch(OFFICE_LAT, OFFICE_LNG, bssid=OFFICE_AP)["accepted"], True)

print("6. The combination that would lock everyone out is refused")
r = client.put("/api/v1/admin/location",
               json={"presence_policy": "wifi_required", "allowed_bssids": []},
               headers=KRISH)
check("wifi_required with no APs refused", r.status_code, 409)
check("reason explains why", "every punch would be refused" in r.json()["detail"], True)
check("policy unchanged", client.get(
    "/api/v1/admin/location", headers=KRISH).json()["presence_policy"], "wifi_required")

print("7. A dangerously tight radius is allowed but called out")
client.put("/api/v1/admin/location",
           json={"presence_policy": "wifi_or_gps"}, headers=KRISH)
r = client.put("/api/v1/admin/location", json={"radius_m": 20}, headers=KRISH)
check("accepted", r.status_code, 200)
check("warned about GPS indoors", "refused at their own desks" in (r.json()["note"] or ""), True)
check("absurd values still refused", client.put(
    "/api/v1/admin/location", json={"radius_m": 99_999}, headers=KRISH).status_code, 422)
check("impossible latitude refused", client.put(
    "/api/v1/admin/location", json={"lat": 999}, headers=KRISH).status_code, 422)

print("8. Every change is audited with old and new")
db.expire_all()
rows = db.scalars(select(AuditLog).where(AuditLog.entity == "location")).all()
check("audited", len(rows) > 0, True)
check("actor recorded", rows[0].actor_label, krish.email)
radius_edits = [r for r in rows if "radius_m" in r.changes]
check("radius change kept both values",
      radius_edits[0].changes["radius_m"], {"old": 200, "new": 300})
bssid_edits = [r for r in rows if "allowed_bssids" in r.changes]
check("bssid change kept the old list",
      bssid_edits[0].changes["allowed_bssids"]["old"], [])

print("9. Coordinates change the answer, still without a restart")
client.put("/api/v1/admin/location",
           json={"lat": 23.0195, "lng": 72.5290, "radius_m": 200}, headers=KRISH)
check("the old office is now the far place",
      punch(OFFICE_LAT, OFFICE_LNG)["accepted"], False)
check("the new one is accepted", punch(23.0195, 72.5290)["accepted"], True)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
