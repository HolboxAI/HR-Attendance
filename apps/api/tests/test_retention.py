"""Run: python3 tests/test_retention.py

Biometric retention: PRD 17.1 says punch selfies go after 90 days and a
reference photo goes when the employee leaves. This deletes evidence and
cannot be undone, so the boundaries are the test.

Throwaway SQLite file and uploads dir; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-retention-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")

from sqlalchemy import select                                  # noqa: E402

from app.core.config import settings                           # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.models.employee import Employee                       # noqa: E402
from app.models.face import FaceEnrollment                     # noqa: E402
from app.models.leave import AuditLog                          # noqa: E402
from app.models.org import Organization                        # noqa: E402
from app.services import retention                             # noqa: E402
from app.services.storage import enrolment_key, punch_key, storage   # noqa: E402

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
TODAY = date(2026, 8, 27)

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


def staff(code, name, exit_on=None):
    e = Employee(id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                 email=f"{name.lower()}@test.local", date_of_exit=exit_on,
                 is_active=exit_on is None)
    db.add(e); db.commit()
    return e


here = staff("BX002", "Nikunj")
gone_long = staff("BX009", "Farhan", exit_on=TODAY - timedelta(days=200))
gone_recent = staff("BX010", "Priya", exit_on=TODAY - timedelta(days=5))

# Punch selfies spread either side of the 90-day line.
RETAIN = settings.punch_selfie_retention_days
old_day = TODAY - timedelta(days=RETAIN + 10)
edge_out = TODAY - timedelta(days=RETAIN + 1)     # just past the line -> goes
edge_in = TODAY - timedelta(days=RETAIN - 1)      # just inside -> stays
fresh = TODAY - timedelta(days=1)

keys = {}
for label, day in (("old", old_day), ("edge_out", edge_out),
                   ("edge_in", edge_in), ("fresh", fresh)):
    k = punch_key(day, uuid.uuid4())
    storage.put(k, JPEG)
    keys[label] = k

# Reference photos: one per person, and a superseded one for the long-gone.
refs = {}
for emp, version in ((here, 1), (gone_long, 1), (gone_recent, 1)):
    k = enrolment_key(emp.id, version)
    storage.put(k, JPEG)
    db.add(FaceEnrollment(id=uuid.uuid4(), org_id=org.id, employee_id=emp.id,
                          photo_key=k, is_active=True))
    refs[emp.emp_code] = k
superseded = enrolment_key(gone_long.id, 2)
storage.put(superseded, JPEG)
db.add(FaceEnrollment(id=uuid.uuid4(), org_id=org.id, employee_id=gone_long.id,
                      photo_key=superseded, is_active=False))
db.commit()


print("1. A dry run reports what it would do and deletes nothing")
result = retention.run(db, org_id=org.id, today=TODAY, dry_run=True)
check("says it is a dry run", result["dry_run"], True)
check("counts the selfies past the line", result["punch_selfies"]["deleted"], 2)
check("counts the leaver's photos", result["reference_photos"]["deleted"], 2)
for label, k in keys.items():
    check(f"{label} selfie still on disk", storage.exists(k), True)
check("leaver's photo still on disk", storage.exists(refs["BX009"]), True)
check("no audit row for a dry run",
      len(db.scalars(select(AuditLog)).all()), 0)


print("2. The 90-day line is applied exactly")
result = retention.run(db, org_id=org.id, today=TODAY, dry_run=False)
check("cutoff is today minus the window",
      result["punch_selfies"]["cutoff"], (TODAY - timedelta(days=RETAIN)).isoformat())
check("well-past selfie deleted", storage.exists(keys["old"]), False)
check("one day past the line deleted", storage.exists(keys["edge_out"]), False)
check("one day inside the line KEPT", storage.exists(keys["edge_in"]), True)
check("yesterday's selfie kept", storage.exists(keys["fresh"]), True)


print("3. Reference photos go when someone has left, not before")
check("long-gone leaver's active photo deleted", storage.exists(refs["BX009"]), False)
check("their superseded photo also deleted", storage.exists(superseded), False)
check("recent leaver still inside the grace period",
      storage.exists(refs["BX010"]), True)
check("current employee untouched", storage.exists(refs["BX002"]), True)


print("4. Rows survive; only the images go")
db.expire_all()
rows = db.scalars(select(FaceEnrollment).where(
    FaceEnrollment.employee_id == gone_long.id)).all()
check("enrolment rows kept for the audit trail", len(rows), 2)
check("but marked inactive - no photo means no comparison",
      all(not r.is_active for r in rows), True)
check("the employee row is untouched",
      db.get(Employee, gone_long.id) is not None, True)


print("5. The sweep is auditable")
logs = db.scalars(select(AuditLog).where(AuditLog.entity == "photo_retention")).all()
check("one audit row", len(logs), 1)
check("records how many selfies went",
      logs[0].changes["punch_selfies"]["old"], 2)
check("records how many reference photos went",
      logs[0].changes["reference_photos"]["old"], 2)
check("and says what the policy was",
      "older than" in (logs[0].note or ""), True)


print("6. Running it again is a no-op, not an error")
again = retention.run(db, org_id=org.id, today=TODAY, dry_run=False)
check("nothing left to delete", again["punch_selfies"]["deleted"], 0)
check("no reference photos left either", again["reference_photos"]["deleted"], 0)
db.expire_all()
check("no second audit row for an empty sweep",
      len(db.scalars(select(AuditLog).where(
          AuditLog.entity == "photo_retention")).all()), 1)


print("7. A missing file is not an error - it is already compliant")
storage.put(keys["fresh"], JPEG)
storage.delete(keys["fresh"])
check("deleting an absent key returns 0 bytes", storage.delete(keys["fresh"]), 0)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
