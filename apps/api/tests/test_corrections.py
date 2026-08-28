"""Run: python3 tests/test_corrections.py

The employee-initiated correction workflow (PRD section 11) and the
notification records it produces (PRD section 15).

Throwaway SQLite file; never touches data/boxcode.db.
"""
import os
import sys
import tempfile
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-corrections-"))
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
from app.models.attendance import (                            # noqa: E402
    AttendanceDay, PunchEvent, ShiftAssignment, ShiftTemplate,
)
from app.models.correction import CorrectionRequest            # noqa: E402
from app.models.employee import Employee, User                 # noqa: E402
from app.models.enums import (                                 # noqa: E402
    PunchDirection, PunchSource, UserRole,
)
from app.models.leave import AuditLog                          # noqa: E402
from app.models.notification import Notification               # noqa: E402
from app.models.org import Location, Organization              # noqa: E402
from app.services.attendance import recompute_day, record_punch    # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
PW = "a-test-only-passphrase"

ok = True
_ticks: dict[str, bool] = {}


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")
    return good


def box(item, passed):
    _ticks[item] = _ticks.get(item, True) and passed


Base.metadata.create_all(engine)
db = SessionLocal()
org = Organization(id=uuid.uuid4(), name="Test Org")
db.add(org); db.commit()
loc = Location(id=uuid.uuid4(), org_id=org.id, name="Office")
db.add(loc); db.commit()
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
    db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=e.id,
                           shift_template_id=shift.id, effective_from=date(2026, 1, 1)))
    db.add(User(id=uuid.uuid4(), org_id=org.id, employee_id=e.id, email=e.email,
                password_hash=hash_password(PW), role=role))
    db.commit()
    return e


ashley = make("BX006", "Ashley", UserRole.HR_ADMIN)
daksh = make("BX004", "Daksh", UserRole.EMPLOYEE)
nikunj = make("BX002", "Nikunj", UserRole.EMPLOYEE)

client = TestClient(app)


def token(emp):
    r = client.post("/api/v1/auth/login", json={"email": emp.email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


ASHLEY, DAKSH, NIKUNJ = token(ashley), token(daksh), token(nikunj)

# Daksh checked in last Tuesday and never checked out.
DAY = date(2026, 8, 18)
assert DAY.weekday() == 1
record_punch(db, org_id=org.id, employee=daksh,
             event_ts=datetime.combine(DAY, time(9, 30), tzinfo=IST),
             source=PunchSource.MOBILE_APP, direction=PunchDirection.IN,
             geofence_ok=True, face_ok=True)
db.commit()
recompute_day(db, daksh, DAY)
db.commit()


def day_row(emp, on):
    db.expire_all()
    return db.scalar(select(AttendanceDay).where(
        AttendanceDay.employee_id == emp.id, AttendanceDay.shift_date == on))


def notes_for(emp, category=None):
    db.expire_all()
    u = db.scalar(select(User).where(User.employee_id == emp.id))
    stmt = select(Notification).where(Notification.user_id == u.id)
    if category:
        stmt = stmt.where(Notification.category == category)
    return db.scalars(stmt).all()


print("1. The flagged day is an exception, not an absence")
row = day_row(daksh, DAY)
box("flagged", check("has_exception", row.has_exception, True))
box("flagged", check("not marked absent", row.status.value != "absent", True))
note = (row.exception_note or "").lower()
box("flagged", check("note explains what is wrong",
                     "punch-out" in note or "one punch" in note, True))


print("2. The employee submits the correction, not HR")
claimed = datetime.combine(DAY, time(18, 30), tzinfo=IST)
r = client.post("/api/v1/corrections", headers=DAKSH, json={
    "shift_date": DAY.isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "Left at 6:30, forgot to punch",
})
box("employee-submits", check("accepted", r.status_code, 200))
cid = r.json()["id"]
box("employee-submits", check("starts pending", r.json()["status"], "pending"))
box("employee-submits", check("shows in their own list", len(
    client.get("/api/v1/corrections/my-requests", headers=DAKSH).json()), 1))
box("employee-submits", check("a reason is required", client.post(
    "/api/v1/corrections", headers=NIKUNJ, json={
        "shift_date": DAY.isoformat(), "direction": "out",
        "claimed_at": claimed.isoformat(), "reason": "   "}).status_code, 409))
box("employee-submits", check("cannot correct the future", client.post(
    "/api/v1/corrections", headers=NIKUNJ, json={
        "shift_date": (date.today() + timedelta(days=3)).isoformat(),
        "direction": "out", "claimed_at": claimed.isoformat(),
        "reason": "nope"}).status_code, 409))


print("3. HR is notified that something needs deciding")
hr_notes = notes_for(ashley, "correction.submitted")
box("hr-notified", check("HR got a notification", len(hr_notes), 1))
box("hr-notified", check("names the person", "Daksh" in hr_notes[0].title, True))
box("hr-notified", check("carries the id to act on",
                         hr_notes[0].data.get("correction_id"), cid))
box("hr-notified", check("unread to begin with", hr_notes[0].read_at is None, True))
box("hr-notified", check("not 'sent' - no push provider configured",
                         hr_notes[0].sent_at is None, True))


print("4. It appears in HR's queue, and only HR's")
q = client.get("/api/v1/admin/corrections/pending", headers=ASHLEY)
box("hr-queue", check("HR sees it", len(q.json()), 1))
box("hr-queue", check("with the reason attached",
                      "forgot to punch" in q.json()[0]["reason"], True))
box("hr-queue", check("employee cannot see the queue", client.get(
    "/api/v1/admin/corrections/pending", headers=DAKSH).status_code, 403))
box("hr-queue", check("signed out cannot either", client.get(
    "/api/v1/admin/corrections/pending").status_code, 401))
box("hr-queue", check("employee cannot decide", client.post(
    f"/api/v1/admin/corrections/{cid}/decide", headers=NIKUNJ,
    json={"approve": True}).status_code, 403))


print("5. Two requests for the same day and direction cannot both exist")
dup = client.post("/api/v1/corrections", headers=DAKSH, json={
    "shift_date": DAY.isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "asking again"})
box("no-duplicates", check("refused", dup.status_code, 409))
box("no-duplicates", check("says why", "already have" in dup.json()["detail"], True))
other = client.post("/api/v1/corrections", headers=DAKSH, json={
    "shift_date": DAY.isoformat(), "direction": "in",
    "claimed_at": claimed.isoformat(), "reason": "different direction is fine"})
box("no-duplicates", check("the other direction is allowed", other.status_code, 200))
client.post(f"/api/v1/corrections/{other.json()['id']}/cancel", headers=DAKSH)


print("6. Approving creates a punch and recomputes the day")
punches_before = len(db.scalars(select(PunchEvent).where(
    PunchEvent.employee_id == daksh.id)).all())
r = client.post(f"/api/v1/admin/corrections/{cid}/decide", headers=ASHLEY,
                json={"approve": True, "note": "Confirmed with Daksh"})
box("approve-fixes", check("approved", r.status_code, 200))
box("approve-fixes", check("status is approved", r.json()["status"], "approved"))
db.expire_all()
punches_after = len(db.scalars(select(PunchEvent).where(
    PunchEvent.employee_id == daksh.id)).all())
box("approve-fixes", check("a punch was added", punches_after, punches_before + 1))
row = day_row(daksh, DAY)
box("approve-fixes", check("the day was recomputed with no other action",
                           row.punch_count, 2))


print("7. The original punch is untouched, and the new one says where it came from")
db.expire_all()
originals = db.scalars(select(PunchEvent).where(
    PunchEvent.employee_id == daksh.id,
    PunchEvent.source == PunchSource.MOBILE_APP)).all()
box("original-intact", check("original mobile punch still there", len(originals), 1))
manual = db.scalars(select(PunchEvent).where(
    PunchEvent.employee_id == daksh.id,
    PunchEvent.source == PunchSource.MANUAL)).all()
box("original-intact", check("exactly one manual punch", len(manual), 1))
box("original-intact", check("it links back to the request",
                             manual[0].raw_payload.get("correction_request_id"), cid))
box("original-intact", check("it records who approved it",
                             manual[0].raw_payload.get("actor"), ashley.email))
box("original-intact", check("and what was claimed",
                             "claimed_at" in manual[0].raw_payload, True))
db.expire_all()
req = db.get(CorrectionRequest, uuid.UUID(cid))
box("original-intact", check("the request points at the punch it created",
                             req.punch_event_id, manual[0].id))


print("8. The employee is told the outcome")
approved = notes_for(daksh, "correction.approved")
box("employee-told", check("one notification", len(approved), 1))
box("employee-told", check("carries the decider's note",
                           approved[0].body, "Confirmed with Daksh"))
box("employee-told", check("readable via the API", len(
    client.get("/api/v1/notifications", headers=DAKSH).json()) >= 1, True))
unread = client.get("/api/v1/notifications/unread-count", headers=DAKSH).json()
box("employee-told", check("counted as unread", unread["unread"] >= 1, True))
nid = client.get("/api/v1/notifications", headers=DAKSH).json()[0]["id"]
box("employee-told", check("can be marked read", client.post(
    f"/api/v1/notifications/{nid}/read", headers=DAKSH).json()["read"], True))
box("employee-told", check("cannot read someone else's", client.post(
    f"/api/v1/notifications/{nid}/read", headers=NIKUNJ).status_code, 404))


print("9. Nobody decides their own correction, HR included")
own = client.post("/api/v1/corrections", headers=ASHLEY, json={
    "shift_date": DAY.isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "my own day"})
box("no-self-approval", check("hr_admin can submit one", own.status_code, 200))
r = client.post(f"/api/v1/admin/corrections/{own.json()['id']}/decide",
                headers=ASHLEY, json={"approve": True})
box("no-self-approval", check("but cannot decide it", r.status_code, 409))
box("no-self-approval", check("and is told why",
                              "your own" in r.json()["detail"].lower(), True))


print("10. Rejecting changes nothing about the day")
rej = client.post("/api/v1/corrections", headers=NIKUNJ, json={
    "shift_date": DAY.isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "I was there, honest"})
rid = rej.json()["id"]
before = len(db.scalars(select(PunchEvent).where(
    PunchEvent.employee_id == nikunj.id)).all())
r = client.post(f"/api/v1/admin/corrections/{rid}/decide", headers=ASHLEY,
                json={"approve": False, "note": "No badge record for that evening"})
box("reject-clean", check("rejected", r.json()["status"], "rejected"))
db.expire_all()
after = len(db.scalars(select(PunchEvent).where(
    PunchEvent.employee_id == nikunj.id)).all())
box("reject-clean", check("no punch created", after, before))
told = notes_for(nikunj, "correction.rejected")
box("reject-clean", check("employee told, with the reason",
                          told[0].body, "No badge record for that evening"))
box("reject-clean", check("cannot decide it twice", client.post(
    f"/api/v1/admin/corrections/{rid}/decide", headers=ASHLEY,
    json={"approve": True}).status_code, 409))


print("11. Cancelling is the employee's own, and only while pending")
c = client.post("/api/v1/corrections", headers=NIKUNJ, json={
    "shift_date": date(2026, 8, 19).isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "will withdraw"})
cancel_id = c.json()["id"]
box("cancel", check("someone else cannot cancel it", client.post(
    f"/api/v1/corrections/{cancel_id}/cancel", headers=DAKSH).status_code, 404))
box("cancel", check("the owner can", client.post(
    f"/api/v1/corrections/{cancel_id}/cancel", headers=NIKUNJ).json()["status"],
    "cancelled"))
box("cancel", check("row survives - status, not delete",
                    db.get(CorrectionRequest, uuid.UUID(cancel_id)) is not None, True))
box("cancel", check("an approved one cannot be cancelled", client.post(
    f"/api/v1/corrections/{cid}/cancel", headers=DAKSH).status_code, 409))


print("12. A decided request stops nagging the admins' inboxes")
# "Karan needs a correction" fans out to every admin. Once ONE of them
# decides it, the item is dealt with for all of them - marked read, never
# deleted, so the record of being told survives.
nag = client.post("/api/v1/corrections", headers=NIKUNJ, json={
    "shift_date": date(2026, 8, 21).isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "left for the airport"})
nag_id = nag.json()["id"]
fresh = [n for n in notes_for(ashley, "correction.submitted")
         if n.data.get("correction_id") == nag_id]
box("inbox-clears", check("submitting notifies HR, unread",
                          [bool(n.read_at) for n in fresh], [False]))
client.post(f"/api/v1/admin/corrections/{nag_id}/decide", headers=ASHLEY,
            json={"approve": False, "note": "no"})
after_decide = [n for n in notes_for(ashley, "correction.submitted")
                if n.data.get("correction_id") == nag_id]
box("inbox-clears", check("deciding marks it read for the admins",
                          [bool(n.read_at) for n in after_decide], [True]))
box("inbox-clears", check("the row survives as the record", len(after_decide), 1))
# Withdrawal clears it too - a nag must not outlive its request.
nag2 = client.post("/api/v1/corrections", headers=NIKUNJ, json={
    "shift_date": date(2026, 8, 22).isoformat(), "direction": "out",
    "claimed_at": claimed.isoformat(), "reason": "will withdraw"})
nag2_id = nag2.json()["id"]
client.post(f"/api/v1/corrections/{nag2_id}/cancel", headers=NIKUNJ)
after_cancel = [n for n in notes_for(ashley, "correction.submitted")
                if n.data.get("correction_id") == nag2_id]
box("inbox-clears", check("cancelling clears it too",
                          [bool(n.read_at) for n in after_cancel], [True]))


print("13. Every decision is audited")
db.expire_all()
logs = db.scalars(select(AuditLog).where(
    AuditLog.entity == "correction_request")).all()
box("audited", check("approve, reject and cancel all logged", len(logs) >= 3, True))
approve_log = [x for x in logs if x.action == "approve"]
box("audited", check("records the transition",
                     approve_log[0].changes["status"], {"old": "pending", "new": "approved"}))
box("audited", check("and who did it", approve_log[0].actor_label, ashley.email))

db.close()

print("\n" + "=" * 62)
print("Correction workflow - PRD section 11")
print("=" * 62)
LABELS = {
    "flagged": "Missing punch-out is an exception, not an absence",
    "employee-submits": "The employee submits, with a reason",
    "hr-notified": "HR is notified something needs deciding",
    "hr-queue": "It reaches HR's queue, and only HR's",
    "no-duplicates": "Two live requests for one day cannot coexist",
    "approve-fixes": "Approving creates a punch and recomputes the day",
    "original-intact": "Original punch untouched; new one is attributable",
    "employee-told": "The employee is told the outcome",
    "no-self-approval": "Nobody decides their own, HR included",
    "reject-clean": "Rejecting changes nothing about the day",
    "cancel": "Cancelling is a status, and the owner's alone",
    "inbox-clears": "A decided request stops nagging the admins",
    "audited": "Every decision is audited",
}
for k, label in LABELS.items():
    print(f"  [{'x' if _ticks.get(k) else ' '}] {label}")
print()
print("ALL PASS" if ok else "FAILURES ABOVE")
sys.exit(0 if ok else 1)
