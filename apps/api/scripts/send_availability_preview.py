"""One-off: send Team availability outlook preview to krish@holbox.ai from live data."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.org import Organization
from app.services.notifications import send_planned_absence_email
from app.services.planned_absence import notice_roster


def main() -> None:
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization).limit(1))
        if org is None:
            raise SystemExit("No organization")
        as_of = date.today()
        people = notice_roster(db, org.id, as_of)
        print("PEOPLE with leave/notice", len(people))
        for p in people:
            print(" ", p["code"], p["name"], "→", p["dates"])
        send_planned_absence_email(
            as_of=as_of,
            people=people,
            only_to="krish@holbox.ai",
            preview=True,
        )
        print("SENT preview to krish@holbox.ai")
    finally:
        db.close()


if __name__ == "__main__":
    main()
