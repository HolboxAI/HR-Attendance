"""Face enrolment: the reference photo every punch selfie is compared against.

Until an employee has one of these, the face check has nothing to compare to
and cannot mean anything. That is why this is milestone 1.

Two rules shape the whole module:

- **Enrolment is append-only, like punches.** Re-enrolling does not overwrite
  the old photo, it deactivates it and adds a row. When someone disputes a
  match six months from now, we need the photo that was actually in force on
  the day, not the one that replaced it.
- **The photo is checked before it is stored.** A blurry or two-faced
  reference photo silently poisons every future comparison for that person,
  and the failure surfaces as "the app won't let me check in" weeks later.
  Rejecting it at upload is the only cheap moment.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.face import FaceEnrollment
from app.services.face import FaceResult, get_face_service
from app.services.storage import enrolment_key, image_extension, storage

# A reference photo is worth more care than a punch selfie: it is used for
# years, so we cap it smaller and demand it actually be an image.
MAX_ENROLMENT_BYTES = 8 * 1024 * 1024


def active_enrolment(db: Session, employee: Employee) -> FaceEnrollment | None:
    """The photo currently in force for this employee, if any."""
    return db.scalar(
        select(FaceEnrollment)
        .where(
            FaceEnrollment.employee_id == employee.id,
            FaceEnrollment.is_active.is_(True),
        )
        .order_by(FaceEnrollment.enrolled_at.desc())
    )


def reference_bytes(db: Session, employee: Employee) -> bytes:
    """Bytes of the active reference photo, or b"" if there isn't one.

    Returning empty rather than raising is deliberate: the punch path treats
    "not enrolled" as a verification outcome to be recorded, not an error to
    be thrown. See the face_ok=NULL handling in routes/mobile.py.
    """
    row = active_enrolment(db, employee)
    if row is None:
        return b""
    try:
        return storage.get(row.photo_key)
    except FileNotFoundError:
        # The row says enrolled, the file is gone. Treat as not enrolled: a
        # missing reference must never become a passing comparison.
        return b""


def history(db: Session, employee: Employee) -> list[FaceEnrollment]:
    """Every reference photo this employee has had, newest first."""
    return list(
        db.scalars(
            select(FaceEnrollment)
            .where(FaceEnrollment.employee_id == employee.id)
            .order_by(FaceEnrollment.enrolled_at.desc())
        ).all()
    )


def next_version(db: Session, employee: Employee) -> int:
    return len(history(db, employee)) + 1


def enrol(
    db: Session,
    *,
    employee: Employee,
    image: bytes,
    actor_id: uuid.UUID | None = None,
) -> tuple[FaceEnrollment | None, FaceResult]:
    """Validate a reference photo, store it, and make it the active one.

    Returns (row, result). On a quality failure the row is None, nothing is
    written, and result.reason is what HR should be shown.
    """
    if not image:
        return None, FaceResult(False, None, "No photo supplied")
    if len(image) > MAX_ENROLMENT_BYTES:
        return None, FaceResult(False, None, "Photo too large - compress before upload")

    quality = get_face_service().quality_check(image)
    if not quality.matched:
        return None, quality

    # Store under a fresh version so the previous photo stays retrievable.
    version = next_version(db, employee)
    key = enrolment_key(employee.id, version, image_extension(image))
    storage.put(key, image)

    # Deactivate first, then insert: for a moment there must be zero active
    # rows rather than two, because "which photo is in force" has to have one
    # answer even if this transaction dies halfway.
    for row in db.scalars(
        select(FaceEnrollment).where(
            FaceEnrollment.employee_id == employee.id,
            FaceEnrollment.is_active.is_(True),
        )
    ).all():
        row.is_active = False

    record = FaceEnrollment(
        id=uuid.uuid4(),
        org_id=employee.org_id,
        employee_id=employee.id,
        photo_key=key,
        is_active=True,
        enrolled_by=actor_id,
        enrolled_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.flush()
    return record, FaceResult(True, None, f"Enrolled (v{version})")


def retire(db: Session, employee: Employee) -> bool:
    """Withdraw the active photo without supplying a replacement.

    Used when a photo turns out to be wrong. Nothing is deleted - the row stays
    for the audit trail, it just stops being the one in force. The employee is
    then unenrolled, and REQUIRE_FACE_ENROLMENT decides whether they can punch.
    """
    row = active_enrolment(db, employee)
    if row is None:
        return False
    row.is_active = False
    db.flush()
    return True
