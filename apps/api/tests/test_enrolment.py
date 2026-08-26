"""Run: python3 tests/test_enrolment.py

Covers the thing that made the face check meaningless: a punch with no
reference photo used to be recorded as face_ok=True.

Uses a throwaway SQLite file and a throwaway uploads directory, so it never
touches data/boxcode.db.
"""
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-enrol-"))

# Point the app at a scratch database BEFORE anything imports settings, since
# the engine is built at import time from this value.
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from sqlalchemy import select                                  # noqa: E402

from app.core.config import settings                           # noqa: E402
from app.core.security import hash_password                    # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.models.attendance import PunchEvent                   # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import UserRole                          # noqa: E402
from app.models.face import FaceEnrollment                     # noqa: E402
from app.models.org import Organization                        # noqa: E402
from app.services.enrolment import (                           # noqa: E402
    active_enrolment, enrol, history, reference_bytes, retire,
)
from app.services.face import NOT_ENROLLED, get_face_service   # noqa: E402
from app.services.storage import storage                       # noqa: E402

# A minimal but genuinely valid JPEG header, and a PNG one. The quality check
# sniffs magic bytes, so "not an image" has to actually not be an image.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
JPEG2 = b"\xff\xd8\xff\xe0" + b"\x11" * 512 + b"\xff\xd9"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 128
NOT_AN_IMAGE = b"this is a PDF, honest" * 10

ok = True


def brief(v):
    if isinstance(v, bytes) and len(v) > 12:
        return f"<{len(v)} bytes starting {v[:4]!r}>"
    return repr(v)


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {brief(got)}, want {brief(want)}")


Base.metadata.create_all(engine)
storage.root = TMP / "uploads"
storage.root.mkdir(parents=True, exist_ok=True)

db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org)
db.commit()          # the org must exist before anything can reference it
alice = Employee(id=uuid.uuid4(), org_id=org.id, emp_code="TX001", full_name="Alice",
                 email="alice@test.local")
bob = Employee(id=uuid.uuid4(), org_id=org.id, emp_code="TX002", full_name="Bob",
               email="bob@test.local")
db.add_all([alice, bob])
db.commit()

PW = "a-test-only-passphrase"
db.add_all([
    User(id=uuid.uuid4(), org_id=org.id, employee_id=alice.id, email=alice.email,
         password_hash=hash_password(PW), role=UserRole.HR_ADMIN),
    User(id=uuid.uuid4(), org_id=org.id, employee_id=bob.id, email=bob.email,
         password_hash=hash_password(PW), role=UserRole.EMPLOYEE),
])
db.commit()


print("1. An employee with no photo is not enrolled")
check("active_enrolment is None", active_enrolment(db, alice) is None, True)
check("reference_bytes is empty", reference_bytes(db, alice), b"")

print("2. The stub refuses to match against nothing")
r = get_face_service().verify(enrolled_bytes=b"", selfie_bytes=JPEG)
check("matched", r.matched, False)
check("reason", r.reason, NOT_ENROLLED)

print("3. A file that is not an image is rejected, and nothing is stored")
row, res = enrol(db, employee=alice, image=NOT_AN_IMAGE)
check("no row created", row is None, True)
check("reason mentions JPEG or PNG", "JPEG or PNG" in (res.reason or ""), True)
check("still not enrolled", active_enrolment(db, alice) is None, True)

print("4. An empty upload is rejected")
row, res = enrol(db, employee=alice, image=b"")
check("no row created", row is None, True)

print("5. Enrolling a real photo")
row, res = enrol(db, employee=alice, image=JPEG)
db.commit()
check("row created", row is not None, True)
check("is active", row.is_active, True)
check("version 1 in key", row.photo_key.endswith("/v1.jpg"), True)
check("bytes come back", reference_bytes(db, alice), JPEG)

print("6. The stub now matches, because there is something to match against")
r = get_face_service().verify(enrolled_bytes=reference_bytes(db, alice), selfie_bytes=JPEG)
check("matched", r.matched, True)
check("has a similarity", r.similarity is not None, True)

print("7. PNG is accepted too")
row_b, res_b = enrol(db, employee=bob, image=PNG)
db.commit()
check("bob enrolled", row_b is not None, True)
check("bob's bytes", reference_bytes(db, bob), PNG)
check("stored as .png, not .jpg", row_b.photo_key.endswith("/v1.png"), True)

print("8. Enrolling is per-employee, not global")
check("alice still has her own photo", reference_bytes(db, alice), JPEG)

print("9. Re-enrolling supersedes rather than overwrites")
row2, _ = enrol(db, employee=alice, image=JPEG2)
db.commit()
check("new row is active", row2.is_active, True)
check("version 2 in key", row2.photo_key.endswith("/v2.jpg"), True)
check("reference is the new photo", reference_bytes(db, alice), JPEG2)
check("two rows in history", len(history(db, alice)), 2)
actives = [h for h in history(db, alice) if h.is_active]
check("exactly one active", len(actives), 1)
check("old photo still on disk", storage.exists(row.photo_key), True)
check("old photo bytes intact", storage.get(row.photo_key), JPEG)

print("10. Retiring a photo unenrols without deleting history")
check("retire returns True", retire(db, alice), True)
db.commit()
check("no active enrolment", active_enrolment(db, alice) is None, True)
check("reference_bytes empty again", reference_bytes(db, alice), b"")
check("history is preserved", len(history(db, alice)), 2)
check("retiring again is False", retire(db, alice), False)

print("11. A row whose file vanished counts as NOT enrolled, never as a match")
enrol(db, employee=alice, image=JPEG)
db.commit()
current = active_enrolment(db, alice)
storage.path_for(current.photo_key).unlink()
check("row still says active", current.is_active, True)
check("but reference_bytes is empty", reference_bytes(db, alice), b"")
r = get_face_service().verify(enrolled_bytes=reference_bytes(db, alice), selfie_bytes=JPEG)
check("so the face check refuses", r.matched, False)
retire(db, alice)
db.commit()

# --------------------------------------------------------------------------
# The integration half: what actually lands in punch_events.
# --------------------------------------------------------------------------
from fastapi.testclient import TestClient    # noqa: E402
from app.main import app                     # noqa: E402

client = TestClient(app)
AT_OFFICE = {"lat": "23.0315", "lng": "72.5298", "accuracy_m": "12"}


def sign_in(emp):
    """Log in and register a handset, exactly as the app does."""
    install_id = f"handset-{emp.emp_code}"
    res = client.post("/api/v1/auth/login", json={
        "email": emp.email, "password": PW,
        "install_id": install_id, "platform": "ios",
    })
    assert res.status_code == 200, res.text
    return res.json()["access_token"], install_id


ALICE_TOKEN, ALICE_INSTALL = sign_in(alice)
BOB_TOKEN, BOB_INSTALL = sign_in(bob)
# Alice is hr_admin, so the same token both punches and runs the enrolment
# screens. Roles stack; an admin does not stop being an employee.
ADMIN = {"Authorization": f"Bearer {ALICE_TOKEN}"}


def punch(emp, token=None, install=None):
    # Punches dedupe per identity per second (see dedupe_hash), which is the
    # right behaviour for a retrying phone and means these scenarios have to
    # land in different seconds or the second one silently returns the first
    # one's row.
    time.sleep(1.05)
    return client.post(
        "/api/v1/mobile/punch",
        files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
        data=AT_OFFICE,
        headers={
            "Authorization": f"Bearer {token or ALICE_TOKEN}",
            "X-Install-Id": install or ALICE_INSTALL,
        },
    ).json()


def last_punch(emp):
    return db.scalars(
        select(PunchEvent)
        .where(PunchEvent.employee_id == emp.id)
        .order_by(PunchEvent.received_ts_utc.desc())
    ).first()


print("12. Unenrolled punch is NOT recorded as a face match (the original bug)")
settings.require_face_enrolment = False
body = punch(alice)
db.expire_all()
ev = last_punch(alice)
check("punch accepted", body.get("accepted"), True)
check("face_ok is NULL, not True", ev.face_ok, None)
check("no similarity invented", ev.face_similarity, None)
check("recorded that no check ran", ev.raw_payload.get("face_checked"), False)

print("13. With enrolment REQUIRED, an unenrolled punch is refused")
settings.require_face_enrolment = True
body = punch(alice)
db.expire_all()
ev = last_punch(alice)
check("rejected", body.get("accepted"), False)
check("told why", body.get("message"), NOT_ENROLLED)
check("stored, not dropped", ev.rejection_reason, NOT_ENROLLED)
check("face_ok still NULL", ev.face_ok, None)

print("14. Enrolled employee punches through with a real comparison")
enrol(db, employee=alice, image=JPEG)
db.commit()
body = punch(alice)
db.expire_all()
ev = last_punch(alice)
check("accepted", body.get("accepted"), True)
check("face_ok is True", ev.face_ok, True)
check("similarity recorded", float(ev.face_similarity) > 0, True)
check("check actually ran", ev.raw_payload.get("face_checked"), True)

settings.require_face_enrolment = False

print("15. The HR enrolment list reports the gap honestly")
r = client.get("/api/v1/admin/enrolments", headers=ADMIN).json()
codes = {row["employee_code"]: row for row in r["rows"]}
check("alice enrolled", codes["TX001"]["enrolled"], True)
check("bob enrolled", codes["TX002"]["enrolled"], True)
check("headcount", r["summary"]["headcount"], 2)
check("enrolled count", r["summary"]["enrolled"], 2)
check("missing count", r["summary"]["missing"], 0)
check("alice's photo history counted", codes["TX001"]["photo_count"], 4)

print("16. Uploading through the API, and reading the photo back")
r = client.post(
    "/api/v1/admin/enrolments",
    files={"photo": ("ref.jpg", JPEG2, "image/jpeg")},
    data={"employee_code": "TX002"}, headers=ADMIN,
)
check("accepted", r.status_code, 200)
img = client.get("/api/v1/admin/enrolments/TX002/photo", headers=ADMIN)
check("photo served", img.status_code, 200)
check("correct bytes", img.content, JPEG2)
check("not cached", img.headers.get("cache-control"), "no-store")

print("17. The API rejects a bad photo with a reason, not a 500")
r = client.post(
    "/api/v1/admin/enrolments",
    files={"photo": ("x.pdf", NOT_AN_IMAGE, "application/pdf")},
    data={"employee_code": "TX002"}, headers=ADMIN,
)
check("400", r.status_code, 400)
check("reason explains", "JPEG or PNG" in r.json()["detail"], True)
db.expire_all()
check("previous photo untouched", reference_bytes(db, bob), JPEG2)

print("18. Unknown employee is a 404 on every enrolment route")
check("list-upload", client.post(
    "/api/v1/admin/enrolments",
    files={"photo": ("r.jpg", JPEG, "image/jpeg")},
    data={"employee_code": "NOPE"}, headers=ADMIN).status_code, 404)
check("photo", client.get("/api/v1/admin/enrolments/NOPE/photo", headers=ADMIN).status_code, 404)
check("delete", client.delete("/api/v1/admin/enrolments/NOPE", headers=ADMIN).status_code, 404)

print("19. Withdrawing through the API")
check("delete ok", client.delete("/api/v1/admin/enrolments/TX002", headers=ADMIN).status_code, 200)
db.expire_all()
check("bob unenrolled", active_enrolment(db, bob) is None, True)
r = client.get("/api/v1/admin/enrolments", headers=ADMIN).json()
check("summary shows the gap", r["summary"]["missing"], 1)
check("delete again is 404", client.delete("/api/v1/admin/enrolments/TX002", headers=ADMIN).status_code, 404)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
