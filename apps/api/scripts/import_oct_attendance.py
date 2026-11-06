import csv
import uuid
import hashlib
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from app.db.session import SessionLocal
from app.models.employee import Employee
from app.models.attendance import PunchEvent
from app.models.enums import PunchSource, PunchDirection
from app.services.attendance import recompute_day
from sqlalchemy import select

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
db = SessionLocal()

csv_path = "/home/ubuntu/boxcode-hrms/data/AttendanceReport_2026-10-01_to_2026-10-21_Generated_on_2026_10_21_21_04.csv"
with open(csv_path) as f:
    rows = list(csv.DictReader(f))

inserted_punches = 0
for r in rows:
    code = r["Employee ID"]
    emp = db.scalar(select(Employee).where(Employee.emp_code == code))
    if not emp:
        continue

    in_date_str = r["Punch-in Date"].split(" ")[:3]
    in_time_str = r["Punch-in Time"]
    out_date_str = r["Punch-out Date"].split(" ")[:3]
    out_time_str = r["Punch-out Time"]

    in_dt = datetime.strptime(" ".join(in_date_str) + " " + in_time_str, "%d %b %Y %I:%M %p").replace(tzinfo=IST)
    out_dt = datetime.strptime(" ".join(out_date_str) + " " + out_time_str, "%d %b %Y %I:%M %p").replace(tzinfo=IST)
    shift_d = in_dt.date()

    # Check if punches exist for this employee on this date
    existing = db.scalars(
        select(PunchEvent).where(
            PunchEvent.employee_id == emp.id,
            PunchEvent.event_ts_utc >= datetime.combine(shift_d, datetime.min.time(), tzinfo=IST).astimezone(UTC),
            PunchEvent.event_ts_utc <= datetime.combine(shift_d, datetime.max.time(), tzinfo=IST).astimezone(UTC),
        )
    ).all()

    if not existing:
        in_utc = in_dt.astimezone(UTC)
        hash_in = hashlib.sha256(f"{emp.org_id}:{emp.id}:{in_utc.isoformat()}:IN".encode()).hexdigest()
        p_in = PunchEvent(
            id=uuid.uuid4(),
            org_id=emp.org_id,
            employee_id=emp.id,
            source=PunchSource.IMPORT,
            direction=PunchDirection.IN,
            event_ts_utc=in_utc,
            received_ts_utc=in_utc,
            raw_payload={"source": "attendance_sheet_oct", "shift": r.get("Shift")},
            dedupe_hash=hash_in,
            is_unmatched=False,
        )
        db.add(p_in)

        out_utc = out_dt.astimezone(UTC)
        hash_out = hashlib.sha256(f"{emp.org_id}:{emp.id}:{out_utc.isoformat()}:OUT".encode()).hexdigest()
        p_out = PunchEvent(
            id=uuid.uuid4(),
            org_id=emp.org_id,
            employee_id=emp.id,
            source=PunchSource.IMPORT,
            direction=PunchDirection.OUT,
            event_ts_utc=out_utc,
            received_ts_utc=out_utc,
            raw_payload={"source": "attendance_sheet_oct", "shift": r.get("Shift")},
            dedupe_hash=hash_out,
            is_unmatched=False,
        )
        db.add(p_out)
        inserted_punches += 2
        print(f"Inserted IN/OUT punches for {code} on {shift_d}: {in_dt.strftime('%H:%M')} -> {out_dt.strftime('%H:%M')}")

db.commit()
print(f"Total inserted punches: {inserted_punches}")

# Recompute all active employees for October 1 to 23
start_d = date(2026, 10, 1)
end_d = date(2026, 10, 23)

all_emps = db.scalars(select(Employee).where(Employee.is_active.is_(True))).all()
recomputed = 0
for emp in all_emps:
    curr = start_d
    while curr <= end_d:
        recompute_day(db, emp, curr)
        recomputed += 1
        curr += timedelta(days=1)

db.commit()
print(f"Recomputed {recomputed} employee-days.")
db.close()
