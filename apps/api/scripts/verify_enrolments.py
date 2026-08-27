"""Re-check every stored reference photo against Rekognition's quality gate.

Run: python3 scripts/verify_enrolments.py

Why this exists. Enrolment calls `get_face_service().quality_check()`, so what
gets enforced depends on the provider that was active AT THE TIME. Under
FACE_PROVIDER=stub that check is magic-bytes-only - it will happily accept a
blurry photo, a photo of two people, or a photo of a wall. Those only fail
later, at the punch, and they fail as "face does not match", which sends
everyone looking at the wrong thing: the employee's selfie rather than the
reference photo behind it.

So: enrol whenever you like, then run this once Rekognition is switched on. It
re-runs the real gate over every active reference photo and names the people
who need a retake.

Reads only. Never deletes an enrolment, never retires one - a bad reference
photo is HR's call to retake, and quietly dropping it would leave someone
unable to punch with no record of why.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.config import settings                       # noqa: E402
from app.db.session import SessionLocal                    # noqa: E402
import app.models                                          # noqa: F401,E402
from app.models.employee import Employee                   # noqa: E402
from app.models.face import FaceEnrollment                 # noqa: E402
from app.services.enrolment import reference_bytes         # noqa: E402
from app.services.face import FaceUnavailable, get_face_service  # noqa: E402


def main() -> int:
    print("\nBoxcode - reference photo check\n" + "-" * 62)
    print(f"provider: {settings.face_provider}")

    if settings.face_provider != "rekognition":
        print(
            "\n  [!] FACE_PROVIDER is 'stub', so this would only re-run the\n"
            "      magic-bytes check that already passed at enrolment time -\n"
            "      it would report everything as fine and prove nothing.\n\n"
            "      Set FACE_PROVIDER=rekognition in apps/api/.env first."
        )
        return 1

    db = SessionLocal()
    service = get_face_service()

    employees = db.scalars(
        select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.emp_code)
    ).all()

    good, bad, missing, errored = [], [], [], []

    for emp in employees:
        enrolment = db.scalar(
            select(FaceEnrollment).where(
                FaceEnrollment.employee_id == emp.id,
                FaceEnrollment.is_active.is_(True),
            )
        )
        if enrolment is None:
            missing.append(emp)
            print(f"  [ ] {emp.emp_code}  {emp.full_name:<18} no reference photo")
            continue

        image = reference_bytes(db, emp)
        if not image:
            # A row pointing at a file that is not there. Worth distinguishing
            # from "never enrolled" - it means storage and the database have
            # drifted apart, which is a different problem.
            errored.append(emp)
            print(f"  [!] {emp.emp_code}  {emp.full_name:<18} row exists, file missing "
                  f"({enrolment.photo_key})")
            continue

        try:
            result = service.quality_check(image)
        except FaceUnavailable as exc:
            errored.append(emp)
            print(f"  [!] {emp.emp_code}  {emp.full_name:<18} Rekognition unavailable: {exc}")
            continue

        if result.matched:
            good.append(emp)
            print(f"  [x] {emp.emp_code}  {emp.full_name:<18} usable")
        else:
            bad.append(emp)
            print(f"  [ ] {emp.emp_code}  {emp.full_name:<18} {result.reason}")

    db.close()

    total = len(employees)
    print("-" * 62)
    print(f"{len(good)}/{total} usable · {len(bad)} need a retake · "
          f"{len(missing)} never enrolled · {len(errored)} errors")

    if bad or missing:
        print(
            "\nThose people cannot punch successfully until this is fixed.\n"
            "Retake at /enrolment on the dashboard - re-enrolment supersedes\n"
            "the old photo rather than destroying it, so the history survives."
        )
    if not bad and not missing and not errored:
        print("\nEvery active employee has a reference photo Rekognition accepts.")
        print("This is the point at which REQUIRE_FACE_ENROLMENT=true is safe.")

    return 0 if not (bad or missing or errored) else 2


if __name__ == "__main__":
    sys.exit(main())
