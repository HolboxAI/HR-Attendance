"""Fire one real push at one employee's registered phone.

    .venv/bin/python scripts/send_test_push.py BX004

This is the END-TO-END proof, not a simulation: it calls the same notify()
every approval and scheduler nudge uses, which writes the Inbox row and
hands the message to Expo's push service, which hands it to FCM, which
rings the handset. If no banner arrives, the printout says which link in
that chain to look at.

Requires PUSH_PROVIDER=expo in apps/api/.env and a phone that has signed
in to a standalone build (that sign-in is what registers the push token).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                      # noqa: E402

from app.core.config import settings               # noqa: E402
from app.db.session import SessionLocal            # noqa: E402
import app.models                                  # noqa: F401,E402
from app.models.employee import Employee, User     # noqa: E402
from app.models.face import MobileDevice           # noqa: E402
from app.services.notifications import notify      # noqa: E402

code = (sys.argv[1] if len(sys.argv) > 1 else "").upper()
if not code:
    sys.exit("Usage: send_test_push.py <EMPLOYEE_CODE>")

db = SessionLocal()
emp = db.scalar(select(Employee).where(Employee.emp_code == code))
if emp is None:
    sys.exit(f"No employee {code}")
user = db.scalar(select(User).where(User.employee_id == emp.id))
if user is None:
    sys.exit(f"{emp.full_name} has no login - nothing to notify")

devices = db.scalars(select(MobileDevice).where(
    MobileDevice.employee_id == emp.id, MobileDevice.is_active.is_(True),
)).all()
tokens = [d for d in devices if d.push_token]

print(f"{emp.full_name} ({code})")
print(f"  push provider : {settings.push_provider}"
      + ("  <- set PUSH_PROVIDER=expo in apps/api/.env" if settings.push_provider != "expo" else ""))
print(f"  active devices: {len(devices)}, with push token: {len(tokens)}")
if not tokens:
    print("  No token yet: sign in on the standalone APK first - login is what")
    print("  registers the phone's push address. Expo Go and web never will.")

row = notify(
    db, org_id=emp.org_id, user=user, category="test",
    title="Holbox Attendance",
    body="You haven't punched out yet. Please complete your attendance.",
    data={"kind": "push-test"},
)
db.commit()

print(f"  Inbox row written: {row.id}")
if row.sent_at:
    print("  PUSH DISPATCHED - Expo accepted it. The banner should be on the")
    print("  phone within seconds, app open, backgrounded or closed.")
else:
    print("  Push NOT dispatched (row still exists and shows in the Inbox).")
    print("  Chain to check: provider=expo -> token registered -> internet.")
db.close()
