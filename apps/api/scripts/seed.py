"""Seed Boxcode: one org, one office, two shifts, the team.

Idempotent - re-running does not duplicate anyone.

    python scripts/seed.py            add anyone missing
    python scripts/seed.py --reset    wipe punches, attendance and staff first

--reset clears rows, never files. Photos in data/uploads stay put.
"""
import sys
import uuid
from datetime import date, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                       # noqa: E402

from app.core.office import OFFICE                  # noqa: E402
from app.db.session import SessionLocal             # noqa: E402
from app.models.attendance import ShiftAssignment, ShiftTemplate   # noqa: E402
from app.models.employee import Employee            # noqa: E402
from app.models.enums import EmploymentType         # noqa: E402
from app.models.org import Department, Location, Organization      # noqa: E402

STAFF = [
    # Real team. Designations are placeholders - correct them and re-run.
    ("BX001", "Krish Sharma", "Engineering", "Founder",           "General"),
    ("BX002", "Nikunj",       "Engineering", "Backend Engineer",  "General"),
    ("BX003", "Shivam",       "Engineering", "Frontend Engineer", "General"),
    ("BX004", "Daksh",        "Engineering", "Mobile Engineer",   "General"),
    ("BX005", "Dhruv",        "Design",      "Product Designer",  "General"),
    ("BX006", "Ashley",       "Operations",  "Operations",        "General"),
    ("BX007", "Ritesh",       "Engineering", "Engineer",          "Night"),
]


def reset(db) -> None:
    from app.models.attendance import AttendanceDay, PunchEvent
    from sqlalchemy import delete
    for model in (AttendanceDay, PunchEvent, ShiftAssignment, Employee):
        db.execute(delete(model))
    db.commit()
    print("reset      : cleared punches, attendance, shift assignments, employees")


def main() -> None:
    db = SessionLocal()
    try:
        if "--reset" in sys.argv:
            reset(db)
        org = db.scalar(select(Organization).where(Organization.name == "Boxcode"))
        if org is None:
            org = Organization(id=uuid.uuid4(), name="Boxcode",
                               timezone=OFFICE["timezone"], country="IN", settings={})
            db.add(org)
            db.flush()

        loc = db.scalar(select(Location).where(Location.org_id == org.id))
        if loc is None:
            loc = Location(id=uuid.uuid4(), org_id=org.id, name=OFFICE["name"],
                           lat=OFFICE["lat"], lng=OFFICE["lng"],
                           geofence_radius_m=OFFICE["radius_m"])
            db.add(loc)
            db.flush()

        depts: dict[str, Department] = {}
        for name in {s[2] for s in STAFF}:
            d = db.scalar(select(Department).where(
                Department.org_id == org.id, Department.name == name))
            if d is None:
                d = Department(id=uuid.uuid4(), org_id=org.id, name=name)
                db.add(d)
                db.flush()
            depts[name] = d

        general = db.scalar(select(ShiftTemplate).where(
            ShiftTemplate.org_id == org.id, ShiftTemplate.name == "General"))
        if general is None:
            general = ShiftTemplate(
                id=uuid.uuid4(), org_id=org.id, name="General",
                start_time=time(9, 30), end_time=time(18, 30),
                break_minutes=60, grace_minutes=15,
                half_day_after_minutes=240, full_day_after_minutes=450,
                cutover_hour=5, working_days=[0, 1, 2, 3, 4],
            )
            db.add(general)

        night = db.scalar(select(ShiftTemplate).where(
            ShiftTemplate.org_id == org.id, ShiftTemplate.name == "Night"))
        if night is None:
            night = ShiftTemplate(
                id=uuid.uuid4(), org_id=org.id, name="Night",
                start_time=time(22, 0), end_time=time(6, 0),
                break_minutes=45, grace_minutes=10,
                half_day_after_minutes=240, full_day_after_minutes=420,
                # Shift ends 06:00, so anything before 09:00 still belongs to
                # the night that started yesterday.
                cutover_hour=9, working_days=[0, 1, 2, 3, 4],
            )
            db.add(night)
        db.flush()

        shifts = {"General": general, "Night": night}

        created = 0
        for code, name, dept, title, shift_name in STAFF:
            emp = db.scalar(select(Employee).where(
                Employee.org_id == org.id, Employee.emp_code == code))
            if emp is not None:
                continue
            emp = Employee(
                id=uuid.uuid4(), org_id=org.id, emp_code=code, full_name=name,
                email=f"{name.split()[0].lower()}@boxcode.ai",
                department_id=depts[dept].id, location_id=loc.id, designation=title,
                employment_type=EmploymentType.FULL_TIME, date_of_joining=date(2026, 1, 5),
            )
            db.add(emp)
            db.flush()
            db.add(ShiftAssignment(id=uuid.uuid4(), employee_id=emp.id,
                                   shift_template_id=shifts[shift_name].id,
                                   effective_from=date(2026, 1, 1)))
            created += 1

        db.commit()
        total = len(db.scalars(select(Employee).where(Employee.org_id == org.id)).all())
        print(f"org       : {org.name} ({org.timezone})")
        print(f"office    : {loc.name}  {loc.lat}, {loc.lng}  r={loc.geofence_radius_m}m")
        print(f"shifts    : General 9:30-18:30, Night 22:00-06:00")
        print(f"employees : {total} total, {created} created this run")
    finally:
        db.close()


if __name__ == "__main__":
    main()
