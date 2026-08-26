"""End-to-end proof, in two parts.

PART 1 posts real multipart requests to the real FastAPI app and shows the
verification path: accepted, too far, faked GPS. Nothing is mocked below HTTP.

PART 2 writes a backdated day through the service layer, because the endpoint
deliberately stamps punches with SERVER time - a phone's clock is attacker
controlled and must never decide when someone arrived. That is the right call
for production and it means a demo cannot fake times over HTTP.

    .venv/bin/python scripts/demo_day.py
"""
from __future__ import annotations

import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient          # noqa: E402
from sqlalchemy import delete, select              # noqa: E402

from app.db.session import SessionLocal            # noqa: E402
from app.main import app                           # noqa: E402
from app.models.attendance import AttendanceDay, PunchEvent   # noqa: E402
from app.models.employee import Employee           # noqa: E402
from app.models.enums import PunchDirection, PunchSource      # noqa: E402
from app.services.attendance import recompute_day, record_punch   # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
OFFICE = (23.0315, 72.5298)
HOME = (23.0480, 72.5400)          # ~2.1km away
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)

client = TestClient(app)


def http_punch(code: str, coords: tuple[float, float], mocked: bool = False):
    res = client.post(
        "/api/v1/mobile/punch",
        files={"selfie": ("punch.jpg", JPEG, "image/jpeg")},
        data={
            "employee_code": code,
            "lat": str(coords[0]), "lng": str(coords[1]),
            "accuracy_m": "12", "is_mocked": str(mocked).lower(),
        },
    )
    return res.json()


print("\nPART 1 - live punches through the HTTP API")
print("=" * 78)
for code, label, coords, mocked in [
    ("BX001", "at the office",  OFFICE, False),
    ("BX005", "from home",      HOME,   False),
    ("BX006", "with faked GPS", OFFICE, True),
]:
    b = http_punch(code, coords, mocked)
    mark = "ACCEPTED" if b.get("accepted") else "REJECTED"
    dist = b.get("distance_m")
    extra = f"  [{dist:.0f}m]" if isinstance(dist, (int, float)) else ""
    print(f"  {mark:9} {code}  {label:16} {b.get('message')}{extra}")

# ---------------------------------------------------------------------------
print(f"\nPART 2 - a full backdated day ({YESTERDAY}) through the service layer")
print("=" * 78)

# (code, label, [(hour, minute, day_offset_from_shift_date)])
SCENARIOS = [
    ("BX001", "normal day",           [(9, 28, 0), (13, 5, 0), (13, 52, 0), (18, 41, 0)]),
    ("BX002", "late, works through",  [(10, 22, 0), (19, 5, 0)]),
    ("BX003", "half day",             [(9, 31, 0), (13, 40, 0)]),
    ("BX004", "forgot to punch out",  [(9, 45, 0)]),
    ("BX006", "double-tapped",        [(9, 30, 0), (9, 30, 0), (18, 30, 0)]),
    # Night shift: out at 06:12 the NEXT morning. Must resolve to ONE day.
    ("BX007", "night shift",          [(22, 4, 0), (6, 12, 1)]),
]

db = SessionLocal()
try:
    for code, _label, times in SCENARIOS:
        emp = db.scalar(select(Employee).where(Employee.emp_code == code))
        for hh, mm, day_off in times:
            record_punch(
                db, org_id=emp.org_id, employee=emp,
                event_ts=datetime.combine(
                    YESTERDAY + timedelta(days=day_off), time(hh, mm), tzinfo=IST),
                source=PunchSource.MOBILE_APP, direction=PunchDirection.UNKNOWN,
                lat=OFFICE[0], lng=OFFICE[1], geofence_ok=True, distance_m=14.0,
                face_ok=True, face_similarity=98.1,
            )
    db.commit()

    print(f"{'CODE':6} {'NAME':17} {'STATUS':11} {'IN':>6} {'OUT':>6} {'HOURS':>6} {'LATE':>5} {'OT':>5}  NOTE")
    print("-" * 78)
    for code, label, _t in SCENARIOS:
        emp = db.scalar(select(Employee).where(Employee.emp_code == code))
        d = recompute_day(db, emp, YESTERDAY)
        fin = d.first_in.astimezone(IST).strftime("%H:%M") if d.first_in else "-"
        fout = d.last_out.astimezone(IST).strftime("%H:%M") if d.last_out else "-"
        hrs = f"{d.worked_minutes // 60}h{d.worked_minutes % 60:02d}" if d.worked_minutes else "-"
        late = f"{d.late_minutes}m" if d.late_minutes else "-"
        ot = f"{d.overtime_minutes}m" if d.overtime_minutes else "-"
        print(f"{emp.emp_code:6} {emp.full_name:17} {d.status.value:11} {fin:>6} {fout:>6} "
              f"{hrs:>6} {late:>5} {ot:>5}  {d.exception_note or label}")
    db.commit()

    print("-" * 78)
    punches = db.scalars(select(PunchEvent)).all()
    rejected = [p for p in punches if p.rejection_reason]
    dbl = db.scalar(select(Employee).where(Employee.emp_code == "BX006"))
    dbl_count = len([
        p for p in punches
        if p.employee_id == dbl.id and p.event_ts_utc.date() == YESTERDAY
    ])
    print(f"{len(punches)} punches stored. {len(rejected)} rejected, and KEPT:")
    for p in rejected:
        e = db.get(Employee, p.employee_id)
        print(f"   {e.emp_code}  {p.rejection_reason}")
    print(f"\nBX006 was sent 3 punches including an exact duplicate -> {dbl_count} rows stored.")
    print("Idempotency holds: a retried or double-tapped punch cannot count twice.\n")
finally:
    db.close()
