"""Run: python3 tests/test_backup.py

PRD 17.5: nightly dumps, 30-day retention, and a restore TESTED before
rollout. The restore test is the half people skip, so most of this file is
about proving the copy is actually usable rather than merely present.

Throwaway SQLite files; never touches data/boxcode.db.
"""
import gzip
import os
import sqlite3
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-backup-"))
DB = TMP / "source.db"
os.environ["DATABASE_URL"] = f"sqlite:///{DB}"
# Pinned, not inherited. Settings read apps/api/.env, so a developer with
# FACE_PROVIDER=rekognition configured would have these tests calling real
# AWS with synthetic images - billed, slow, offline-hostile, and failing for
# a reason that has nothing to do with the code under test.
os.environ["FACE_PROVIDER"] = "stub"
os.environ["STORAGE_DIR"] = str(TMP / "uploads")
os.environ["BACKUP_DIR"] = str(TMP / "backups")

from sqlalchemy import select                                  # noqa: E402

from app.core.config import settings                           # noqa: E402
from app.db.base import Base                                   # noqa: E402
from app.db.session import SessionLocal, engine                # noqa: E402
import app.models                                              # noqa: F401,E402
from app.models.employee import Employee                       # noqa: E402
from app.models.org import Organization                        # noqa: E402
from app.services import backup                                # noqa: E402

BACKUPS = TMP / "backups"

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
for i, name in enumerate(["Nikunj", "Ashley", "Daksh"], start=1):
    db.add(Employee(id=uuid.uuid4(), org_id=org.id, emp_code=f"BX00{i}",
                    full_name=name, email=f"{name.lower()}@test.local"))
db.commit()


print("1. A backup is taken, compressed, and verified as it is written")
result = backup.create(BACKUPS)
check("file exists", result.path.exists(), True)
check("gzipped", result.path.name.endswith(".db.gz"), True)
check("verified at creation", result.verified, True)
check("counted real rows, not just tables", result.rows.get("employees"), 3)
check("smaller than the source", result.bytes_written < DB.stat().st_size, True)


print("2. Two backups in the same second do not overwrite each other")
# Second-resolution stamps collide easily - a cron that fires twice, or a
# manual backup right after the nightly one. A backup tool that eats backups
# is worse than none.
first = backup.create(BACKUPS)
second = backup.create(BACKUPS)
check("distinct filenames", first.path != second.path, True)
check("both on disk", first.path.exists() and second.path.exists(), True)


print("3. It is a real snapshot, taken while the database is OPEN")
# The session above is still connected and has written. A plain file copy can
# capture a torn database here; the sqlite backup API cannot.
db.add(Employee(id=uuid.uuid4(), org_id=org.id, emp_code="BX009",
                full_name="Ritesh", email="ritesh@test.local"))
db.commit()
live = backup.create(BACKUPS)
check("taken with a live connection open", live.verified, True)
check("includes the row written a moment ago", live.rows.get("employees"), 4)


print("4. The backup restores into a usable database")
restored = TMP / "restored.db"
out = backup.restore(live.path, restored)
check("restored file exists", out.exists(), True)
conn = sqlite3.connect(f"file:{restored}?mode=ro", uri=True)
names = [r[0] for r in conn.execute("select full_name from employees order by emp_code")]
conn.close()
check("every employee came back", names, ["Nikunj", "Ashley", "Daksh", "Ritesh"])


print("5. Restore refuses to overwrite something that already exists")
try:
    backup.restore(live.path, restored)
    check("refused", False, True)
except FileExistsError as exc:
    check("refused with a clear reason", "already exists" in str(exc), True)


print("6. A corrupt backup fails verification rather than passing quietly")
broken = BACKUPS / "boxcode-broken.db"
broken.write_bytes(b"this is not a sqlite database at all")
try:
    backup.verify_file(broken)
    check("should not have verified", False, True)
except Exception as exc:
    check("verification raised", isinstance(exc, Exception), True)
    check("and not silently", str(exc) != "", True)
broken.unlink()


print("7. verify_file restore-tests an existing backup on demand")
again = backup.verify_file(live.path)
check("verifies a gzipped backup", again.verified, True)
check("reads the same row count back", again.rows.get("employees"), 4)


print("8. Retention prunes old backups, but never the newest")
old = BACKUPS / "boxcode-20200101-000000.db.gz"
old.write_bytes(gzip.compress(b"old"))
ancient = (datetime.now(timezone.utc) - timedelta(days=400)).timestamp()
os.utime(old, (ancient, ancient))
before = len(backup.listing(BACKUPS))
removed = backup.prune(BACKUPS, keep_days=30)
check("the ancient one was pruned", old in removed, True)
check("only it went", len(removed), 1)
after = backup.listing(BACKUPS)
check("count dropped by one", len(after), before - 1)

# Everything old: the newest must survive regardless.
for path, _, _ in after:
    os.utime(path, (ancient, ancient))
removed2 = backup.prune(BACKUPS, keep_days=30)
survivors = backup.listing(BACKUPS)
check("at least one backup always survives", len(survivors) >= 1, True)
check("a system left off for a year still has its last backup",
      len(survivors), 1)


print("9. A dry run reports without deleting")
extra = backup.create(BACKUPS)
for path, _, _ in backup.listing(BACKUPS):
    if path != extra.path:
        os.utime(path, (ancient, ancient))
count_before = len(backup.listing(BACKUPS))
would = backup.prune(BACKUPS, keep_days=30, dry_run=True)
check("reports what it would remove", len(would) >= 1, True)
check("but removed nothing", len(backup.listing(BACKUPS)), count_before)

db.close()
print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
