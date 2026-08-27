"""Run: python3 tests/test_offline_punch.py

The offline queue's server half. A queued punch carries the time it HAPPENED,
which is the one place a client-supplied timestamp is accepted - so the bounds
on it are the whole test.

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import time as clock
import uuid
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-offline-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
# Pinned, not inherited. Settings read apps/api/.env, so a developer with
# FACE_PROVIDER=rekognition configured would have these tests calling real
# AWS with synthetic images - billed, slow, offline-hostile, and failing for
# a reason that has nothing to do with the code under test.
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from fastapi.testclient import TestClient                      # noqa: E402
from sqlalchemy import select                                  # noqa: E402

from app.core.config import settings                           # noqa: E402
from app.core.security import hash_password                    # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.main import app                                       # noqa: E402
from app.models.attendance import AttendanceDay, PunchEvent, ShiftAssignment, ShiftTemplate  # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import UserRole                          # noqa: E402
from app.models.org import Location, Organization              # noqa: E402
from app.services.storage import storage                       # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
AT_OFFICE = {"lat": "23.0315", "lng": "72.5298", "accuracy_m": "12"}
PW = "a-test-only-passphrase"

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


Base.metadata.create_all(engine)
storage.root = TMP / "uploads"
storage.root.mkdir(parents=True, exist_ok=True)

db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org); db.commit()
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office", lat=23.0315, lng=72.5298)
db.add(loc); db.commit()
shift = ShiftTemplate(
    id=uuid.uuid4(), org_id=org.id, name="General",
    start_time=time(9, 30), end_time=time(18, 30), break_minutes=60,
    grace_minutes=15, half_day_after_minutes=240, full_day_after_minutes=450,
    cutover_hour=5, working_days=[0, 1, 2, 3, 4],
)
db.add(shift); db.commit()

emp = Employee(id=uuid.uuid4(), org_id=org.id, emp_code="BX002", full_name="Nikunj",
               email="nikunj@test.local", location_id=loc.id)
db.add(emp); db.commit()
db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=emp.id,
                       shift_template_id=shift.id, effective_from=datetime(2026, 1, 1).date()))
db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=emp.id, email=emp.email,
            password_hash=hash_password(PW), role=UserRole.EMPLOYEE))
db.commit()

client = TestClient(app)
r = client.post("/api/v1/auth/login", json={
    "email": emp.email, "password": PW, "install_id": "handset-1", "platform": "ios"})
assert r.status_code == 200, r.text
HEAD = {"Authorization": f"Bearer {r.json()['access_token']}", "X-Install-Id": "handset-1"}


def punch(captured_at=None, extra=None):
    data = {**AT_OFFICE, **(extra or {})}
    if captured_at is not None:
        data["captured_at"] = captured_at.isoformat()
    return client.post(
        "/api/v1/mobile/punch",
        files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
        data=data, headers=HEAD,
    )


def aware(dt):
    """SQLite hands back naive datetimes even for DateTime(timezone=True)."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def latest():
    db.expire_all()
    return db.scalars(
        select(PunchEvent).order_by(PunchEvent.received_ts_utc.desc())
    ).first()


print("1. A live punch is unchanged - server time, both clocks agree")
r = punch()
check("accepted", r.json().get("accepted"), True)
ev = latest()
check("not marked queued", ev.raw_payload.get("queued"), False)
check("event and received within a second",
      abs((aware(ev.event_ts_utc) - aware(ev.received_ts_utc)).total_seconds()) < 1, True)

print("2. A queued punch records WHEN IT HAPPENED, not when it arrived")
captured = datetime.now(timezone.utc) - timedelta(hours=2)
r = punch(captured)
check("accepted", r.json().get("accepted"), True)
ev = latest()
check("marked queued", ev.raw_payload.get("queued"), True)
check("event_ts is the captured time",
      abs((aware(ev.event_ts_utc) - captured).total_seconds()) < 2, True)
check("received_ts is now, not then",
      (aware(ev.received_ts_utc) - aware(ev.event_ts_utc)).total_seconds() > 3600, True)
check("the delay is recorded", ev.raw_payload.get("queued_seconds") > 7000, True)
check("confirmation reports the captured time, not the sync time",
      abs((datetime.fromisoformat(r.json()["punched_at"]) - captured).total_seconds()) < 2, True)

print("3. Replaying the same queued punch does not double-count it")
before = len(db.scalars(select(PunchEvent)).all())
punch(captured)
db.expire_all()
check("still one row", len(db.scalars(select(PunchEvent)).all()), before)

print("4. A phone claiming the future is not believed")
# This one is clamped to server time, and so is test 1's. Punches dedupe per
# identity per second, so without this the two collide and the second returns
# the first one's row - the dedupe working exactly as designed.
clock.sleep(1.05)
ahead = datetime.now(timezone.utc) + timedelta(hours=3)
r = punch(ahead, extra={"direction": "out"})
check("accepted", r.json().get("accepted"), True)
ev = latest()
check("clamped to server time, not the future",
      aware(ev.event_ts_utc) <= datetime.now(timezone.utc) + timedelta(seconds=5), True)
check("and says why", "clock is ahead" in (ev.raw_payload.get("queue_note") or "").lower(), True)

print("5. A punch older than the window is refused, with a reason")
stale = datetime.now(timezone.utc) - timedelta(hours=settings.max_queued_punch_hours + 5)
r = punch(stale)
check("422, not silently accepted", r.status_code, 422)
check("tells them what to do", "correction" in r.json()["detail"].lower(), True)
check("names the window", str(settings.max_queued_punch_hours) in r.json()["detail"], True)

print("6. A queued punch files against the day it HAPPENED")
# 23:50 last night, synced this morning. It must land on YESTERDAY, not today
# - that is the whole reason shift_date follows event_ts and not the clock.
# Relative to now so it stays inside the 48h window and cannot rot.
yesterday = (datetime.now(IST) - timedelta(days=1)).date()
late_night = datetime.combine(yesterday, time(23, 50), tzinfo=IST).astimezone(timezone.utc)
r = punch(late_night, extra={"direction": "out"})
check("accepted", r.json().get("accepted"), True)
db.expire_all()
filed = db.scalar(select(AttendanceDay).where(
    AttendanceDay.employee_id == emp.id, AttendanceDay.shift_date == yesterday))
check("filed against yesterday", filed is not None, True)
check("yesterday has the punch", filed.punch_count >= 1 if filed else False, True)
# And the punch itself carries last night's time, not this morning's.
stored = db.scalars(select(PunchEvent).order_by(
    PunchEvent.received_ts_utc.desc())).first()
check("the stored event is timestamped last night",
      aware(stored.event_ts_utc).astimezone(IST).date(), yesterday)

print("7. Auth and binding still apply to a queued punch")
check("no token refused", client.post(
    "/api/v1/mobile/punch", files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
    data={**AT_OFFICE, "captured_at": captured.isoformat()}).status_code, 401)
check("unbound phone refused", client.post(
    "/api/v1/mobile/punch", files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
    data={**AT_OFFICE, "captured_at": captured.isoformat()},
    headers={"Authorization": HEAD["Authorization"], "X-Install-Id": "someone-else"}
    ).status_code, 403)

print("8. A queued punch from home is still refused - the queue is not a bypass")
r = client.post(
    "/api/v1/mobile/punch",
    files={"selfie": ("s.jpg", JPEG, "image/jpeg")},
    data={"lat": "23.0480", "lng": "72.5400", "accuracy_m": "12",
          "captured_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()},
    headers=HEAD,
)
check("rejected", r.json().get("accepted"), False)
check("told the distance", "from the office" in r.json()["message"], True)
ev = latest()
check("stored anyway, with its reason", ev.rejection_reason is not None, True)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
