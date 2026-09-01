"""Run: python3 tests/test_enrolment_requests.py

Self-service enrolment: the employee does the camera work, HR vouches.

The property under test is that self-service must not remove the vouch. A
reference photo is what every future punch is compared against; if people
could activate their own, anyone could register a friend's face and hand
them their attendance. So: submitting never enrols, only approving does, and
nobody approves their own photo.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-enrolreq-"))
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
from app.models.face import EnrolmentRequest, FaceEnrollment   # noqa: E402
from app.models.notification import Notification               # noqa: E402
from app.models.org import Location, Organization              # noqa: E402
from app.services.enrolment import active_enrolment            # noqa: E402

PW = "a-test-only-passphrase"
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
JPEG2 = b"\xff\xd8\xff\xe0" + b"\x11" * 512 + b"\xff\xd9"
JPEG3 = b"\xff\xd8\xff\xe0" + b"\x22" * 512 + b"\xff\xd9"
NOT_IMAGE = b"definitely a word document" * 20
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


def make(code, name, role=UserRole.EMPLOYEE):
    e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                 email=f"{name.lower()}@test.local", location_id=loc.id)
    db.add(e); db.commit()
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=e.id, email=e.email,
                password_hash=hash_password(PW), role=role))
    db.commit()
    return e


himesh = make("BX008", "Himesh", UserRole.HR_ADMIN)
krish = make("BX001", "Krish", UserRole.SUPER_ADMIN)
daksh = make("BX004", "Daksh")

client = TestClient(app)


def token(name):
    r = client.post("/api/v1/auth/login",
                    json={"email": f"{name}@test.local", "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


HIMESH, KRISH, DAKSH = token("himesh"), token("krish"), token("daksh")


def submit(headers, image, name="me.jpg"):
    return client.post("/api/v1/mobile/enrolment", headers=headers,
                       files={"photo": (name, image, "image/jpeg")})


print("1. Submitting")
check("needs a session", client.post("/api/v1/mobile/enrolment").status_code, 401)
r = submit(DAKSH, NOT_IMAGE)
check("garbage refused at the door", r.status_code, 422)
check("with a reason", bool(r.json()["detail"]), True)
r = submit(DAKSH, JPEG)
check("a real photo goes pending", r.status_code, 200)
check("status says pending", r.json()["pending"], True)
check("but NOT enrolled - submitting never enrols", r.json()["enrolled"], False)
db.expire_all()
check("no active enrolment exists", active_enrolment(db, daksh), None)
check("HR was told", db.scalar(select(Notification).where(
    Notification.category == "enrolment.submitted")) is not None, True)

print("2. A newer submission supersedes the pending one")
submit(DAKSH, JPEG2)
db.expire_all()
rows = db.scalars(select(EnrolmentRequest).where(
    EnrolmentRequest.employee_id == daksh.id).order_by(EnrolmentRequest.created_at)).all()
check("two rows - history kept", len(rows), 2)
check("old one superseded, not deleted", rows[0].status, "superseded")
check("new one pending", rows[1].status, "pending")

print("3. HR's queue")
check("employee cannot see the queue", client.get(
    "/api/v1/admin/enrolments/requests", headers=DAKSH).status_code, 403)
q = client.get("/api/v1/admin/enrolments/requests", headers=HIMESH)
check("HR sees exactly the pending one", len(q.json()), 1)
check("named", q.json()[0]["employee_code"], "BX004")
RID = q.json()[0]["id"]
check("HR can view the photo", client.get(
    f"/api/v1/admin/enrolments/requests/{RID}/photo", headers=HIMESH).status_code, 200)
check("employee cannot", client.get(
    f"/api/v1/admin/enrolments/requests/{RID}/photo", headers=DAKSH).status_code, 403)

print("4. Rejecting explains itself to the person")
r = client.post(f"/api/v1/admin/enrolments/requests/{RID}/decide", headers=HIMESH,
                json={"approve": False, "note": "Too dark - stand near a window"})
check("rejected", r.json()["status"], "rejected")
db.expire_all()
check("still not enrolled", active_enrolment(db, daksh), None)
note = db.scalar(select(Notification).where(Notification.category == "enrolment.rejected"))
check("employee notified with the note", note is not None and "window" in note.body, True)
st = client.get("/api/v1/mobile/enrolment", headers=DAKSH).json()
check("app status shows the decision", st["last_decision"], "rejected")
check("and the note", "window" in (st["last_note"] or ""), True)
check("deciding twice refused", client.post(
    f"/api/v1/admin/enrolments/requests/{RID}/decide", headers=HIMESH,
    json={"approve": True}).status_code, 409)

print("5. Approving makes it the reference photo, via the real enrol path")
submit(DAKSH, JPEG)
RID2 = client.get("/api/v1/admin/enrolments/requests", headers=HIMESH).json()[0]["id"]
r = client.post(f"/api/v1/admin/enrolments/requests/{RID2}/decide", headers=HIMESH,
                json={"approve": True})
check("approved", r.json()["status"], "approved")
db.expire_all()
enr = active_enrolment(db, daksh)
check("active enrolment exists now", enr is not None, True)
check("appears in the normal enrolment history", len(client.get(
    "/api/v1/admin/enrolments", headers=HIMESH).json()["rows"]) > 0, True)
check("employee notified", db.scalar(select(Notification).where(
    Notification.category == "enrolment.approved")) is not None, True)
check("app status shows enrolled", client.get(
    "/api/v1/mobile/enrolment", headers=DAKSH).json()["enrolled"], True)

print("6. Someone else's enrolled photo is refused AT SUBMISSION")
# Daksh's reference photo is now JPEG. Himesh submitting the identical image
# is the loophole this closes: it must bounce immediately with a reason, not
# sit in the queue waiting for HR to spot that the face is Daksh's.
r = submit(HIMESH, JPEG)
check("refused", r.status_code, 422)
check("says already registered", "already registered" in r.json()["detail"], True)
check("does NOT name whose it is", "Daksh" in r.json()["detail"], False)
check("nothing queued", len(client.get(
    "/api/v1/admin/enrolments/requests", headers=HIMESH).json()), 0)

print("7. Nobody vouches for their own face")
submit(HIMESH, JPEG3)
own = client.get("/api/v1/admin/enrolments/requests", headers=HIMESH).json()[0]["id"]
r = client.post(f"/api/v1/admin/enrolments/requests/{own}/decide", headers=HIMESH,
                json={"approve": True})
check("self-approval refused", r.status_code, 409)
check("says why", "your own" in r.json()["detail"], True)
check("another admin can", client.post(
    f"/api/v1/admin/enrolments/requests/{own}/decide", headers=KRISH,
    json={"approve": True}).json()["status"], "approved")

print("8. Unknowns are 404")
check("decide", client.post(
    f"/api/v1/admin/enrolments/requests/{uuid.uuid4()}/decide", headers=HIMESH,
    json={"approve": True}).status_code, 404)
check("photo", client.get(
    f"/api/v1/admin/enrolments/requests/{uuid.uuid4()}/photo", headers=HIMESH).status_code, 404)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
