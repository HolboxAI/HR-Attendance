"""Seed leave types, the default policy, and the 2026 holiday calendar.

Idempotent - re-running adds only what is missing and never edits what HR has
since changed. That matters more here than elsewhere: these are HR's settings,
and a seed script that "fixes" a quota Ashley deliberately edited would be a
bug, not a convenience.

    python scripts/seed_leave.py

ON THE HOLIDAY DATES. The fixed-date holidays below are reliable. The
lunar-calendar festivals - Holi, the two Eids, Janmashtami, Diwali and the
rest - move every year and are fixed by Gujarat government notification, not by
arithmetic. Those are seeded with is_confirmed=False and show up in the
dashboard with a "confirm" marker, because a wrong holiday date silently marks
the whole company present or absent on the wrong day. Check them against the
official state list and confirm each one in the UI.
"""
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                        # noqa: E402

from app.db.session import SessionLocal              # noqa: E402
from app.models.enums import AccrualRule             # noqa: E402
from app.models.leave import Holiday, LeaveType      # noqa: E402
from app.models.org import Organization              # noqa: E402
from app.services.leave import policy                # noqa: E402

# code, name, quota, accrual, carries_forward, cap, is_paid, proof, order
TYPES = [
    ("CL",  "Casual Leave",  12, AccrualRule.MONTHLY, False,  0, True,  False, 1),
    ("SL",  "Sick Leave",     6, AccrualRule.MONTHLY, False,  0, True,  False, 2),
    ("EL",  "Earned Leave",  15, AccrualRule.MONTHLY, True,  30, True,  False, 3),
    ("LOP", "Loss of Pay",    0, AccrualRule.NONE,    False,  0, False, False, 9),
]

# (date, name, is_optional, is_confirmed, note)
# CONFIRMED = fixed calendar date. UNCONFIRMED = lunar, verify with the state.
FIXED = "National holiday"
GJ = "Gujarat state holiday"
LUNAR = "Lunar date - confirm against the Gujarat government list"

HOLIDAYS_2026 = [
    (date(2026, 1, 14),  "Makar Sankranti (Uttarayan)", False, True,  GJ),
    (date(2026, 1, 15),  "Vasi Uttarayan",              False, True,  GJ),
    (date(2026, 1, 26),  "Republic Day",                False, True,  FIXED),
    (date(2026, 2, 15),  "Maha Shivaratri",             True,  False, LUNAR),
    (date(2026, 3, 4),   "Holi (Dhuleti)",              False, False, LUNAR),
    (date(2026, 3, 21),  "Ramzan Eid (Eid-ul-Fitr)",    False, False, LUNAR),
    (date(2026, 3, 26),  "Ram Navami",                  True,  False, LUNAR),
    (date(2026, 3, 31),  "Mahavir Jayanti",             True,  False, LUNAR),
    (date(2026, 4, 3),   "Good Friday",                 True,  False, LUNAR),
    (date(2026, 4, 14),  "Dr. Ambedkar Jayanti",        False, True,  FIXED),
    (date(2026, 5, 1),   "Gujarat Day / Labour Day",    False, True,  GJ),
    (date(2026, 5, 27),  "Bakri Eid (Eid-ul-Adha)",     True,  False, LUNAR),
    (date(2026, 6, 16),  "Muharram",                    True,  False, LUNAR),
    (date(2026, 8, 15),  "Independence Day",            False, True,  FIXED),
    (date(2026, 8, 28),  "Raksha Bandhan",              True,  False, LUNAR),
    (date(2026, 9, 4),   "Janmashtami",                 False, False, LUNAR),
    (date(2026, 9, 14),  "Ganesh Chaturthi",            False, False, LUNAR),
    (date(2026, 10, 2),  "Gandhi Jayanti",              False, True,  FIXED),
    (date(2026, 10, 20), "Dussehra (Vijayadashami)",    False, False, LUNAR),
    (date(2026, 11, 8),  "Diwali",                      False, False, LUNAR),
    (date(2026, 11, 9),  "Gujarati New Year (Bestu Varas)", False, False, LUNAR),
    (date(2026, 11, 10), "Bhai Bij",                    True,  False, LUNAR),
    (date(2026, 11, 24), "Guru Nanak Jayanti",          True,  False, LUNAR),
    (date(2026, 12, 25), "Christmas",                   False, True,  FIXED),
]


def main() -> None:
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).where(Organization.name == "Boxcode"))
        if org is None:
            print("No organisation yet - run scripts/seed.py first.")
            sys.exit(1)

        pol = policy(db, org.id)
        made_types = 0
        for code, name, quota, rule, cf, cap, paid, proof, order in TYPES:
            if db.scalar(select(LeaveType).where(
                LeaveType.org_id == org.id, LeaveType.code == code
            )):
                continue
            db.add(LeaveType(
                id=uuid.uuid4(), org_id=org.id, code=code, name=name,
                annual_quota=quota, accrual_rule=rule, carries_forward=cf,
                carry_cap=cap, is_paid=paid, requires_proof=proof, sort_order=order,
            ))
            made_types += 1

        made_days = 0
        for day, name, optional, confirmed, note in HOLIDAYS_2026:
            if db.scalar(select(Holiday).where(
                Holiday.org_id == org.id, Holiday.day == day,
                Holiday.deleted_at.is_(None),
            )):
                continue
            db.add(Holiday(
                id=uuid.uuid4(), org_id=org.id, day=day, name=name,
                is_optional=optional, is_confirmed=confirmed, note=note,
            ))
            made_days += 1

        db.commit()

        total_types = len(db.scalars(select(LeaveType).where(
            LeaveType.org_id == org.id)).all())
        holidays = db.scalars(select(Holiday).where(
            Holiday.org_id == org.id, Holiday.deleted_at.is_(None))).all()
        unconfirmed = [h for h in holidays if not h.is_confirmed]

        year_label = "Jan-Dec" if pol.year_start_month == 1 else "Apr-Mar"
        print(f"leave year : {year_label}")
        print(f"policy     : sandwich={'on' if pol.sandwich_rule else 'off'}, "
              f"backdating={pol.backdate_days} days")
        print(f"types      : {total_types} total, {made_types} created this run")
        print(f"holidays   : {len(holidays)} for 2026, {made_days} created this run")
        if unconfirmed:
            print(f"\n  {len(unconfirmed)} dates follow the lunar calendar and are")
            print("  marked UNCONFIRMED. Check these against the Gujarat government")
            print("  list and confirm them in the dashboard:\n")
            for h in sorted(unconfirmed, key=lambda x: x.day):
                print(f"    {h.day}  {h.day:%a}  {h.name}")
            print()
    finally:
        db.close()


if __name__ == "__main__":
    main()
