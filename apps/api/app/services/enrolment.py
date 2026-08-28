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

from app.models.employee import Employee, User
from app.models.face import EnrolmentRequest, FaceEnrollment
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


# ---------------------------------------------------------------------------
# Self-service submissions: the employee does the camera work, HR vouches.
# ---------------------------------------------------------------------------

def submit_request(
    db: Session, *, employee: Employee, image: bytes,
) -> tuple[EnrolmentRequest | None, FaceResult]:
    """An employee offers their own photo as the next reference photo.

    The quality gate runs NOW, at submission, with whatever provider is live -
    so under Rekognition a blurry or two-faced photo bounces immediately with
    its reason, instead of poisoning the queue and wasting HR's tap. What the
    gate cannot check is the one thing that keeps this a request rather than
    an enrolment: whether the face belongs to this employee. That is the
    decision a human makes.
    """
    if len(image) > MAX_ENROLMENT_BYTES:
        return None, FaceResult(False, None, "Photo too large - keep it under 8 MB")

    quality = get_face_service().quality_check(image)
    if not quality.matched:
        return None, quality

    # One pending request per person. A newer submission supersedes the old
    # one - decided, not deleted, so the history of what was offered survives.
    for old in db.scalars(
        select(EnrolmentRequest).where(
            EnrolmentRequest.employee_id == employee.id,
            EnrolmentRequest.status == "pending",
        )
    ):
        old.status = "superseded"
        old.decided_at = datetime.now(timezone.utc)
        old.note = "Replaced by a newer submission"

    request = EnrolmentRequest(
        id=uuid.uuid4(), org_id=employee.org_id, employee_id=employee.id,
        photo_key=storage.put(
            f"enrolment-requests/{employee.id}/{uuid.uuid4().hex}.{image_extension(image)}",
            image,
        ),
        status="pending",
    )
    db.add(request)
    db.flush()

    from app.services.notifications import notify_hr

    notify_hr(
        db, org_id=employee.org_id, category="enrolment.submitted",
        title=f"{employee.full_name} submitted a face photo",
        body="Review it on the enrolment page - approving makes it their reference photo.",
        data={"employee_code": employee.emp_code, "request_id": str(request.id)},
    )
    return request, quality


def pending_requests(db: Session) -> list[EnrolmentRequest]:
    return list(db.scalars(
        select(EnrolmentRequest)
        .where(EnrolmentRequest.status == "pending")
        .order_by(EnrolmentRequest.created_at)
    ))


def request_bytes(db: Session, request: EnrolmentRequest) -> bytes:
    return storage.get(request.photo_key)


def decide_request(
    db: Session, *, request: EnrolmentRequest, approver: User,
    approve: bool, note: str | None = None,
) -> tuple[bool, str | None]:
    """HR's half: vouch for the face, or say why not.

    Approving runs the photo through the SAME enrol() path an HR-taken photo
    uses - append-only versioning, quality re-check and all - so a
    self-submitted reference photo is indistinguishable downstream from one
    HR captured. Nobody vouches for their own photo, for the same reason
    nobody approves their own leave.
    """
    if request.status != "pending":
        return False, f"Already {request.status}"
    if approver.employee_id == request.employee_id:
        return False, "You cannot approve your own photo - ask another admin"

    employee = db.get(Employee, request.employee_id)
    if employee is None or not employee.is_active:
        return False, "Employee record is inactive"

    request.decided_by = approver.id
    request.decided_at = datetime.now(timezone.utc)
    request.note = note

    from app.models.employee import User as _User
    from app.services.notifications import notify

    owner = db.scalar(select(_User).where(_User.employee_id == employee.id))

    if approve:
        enrolment, quality = enrol(
            db, employee=employee, image=request_bytes(db, request),
            actor_id=approver.id,
        )
        if enrolment is None:
            # The photo passed at submission but fails now - provider got
            # stricter, or the file rotted. Refuse the decision rather than
            # half-apply it.
            return False, quality.reason or "Photo no longer passes the quality check"
        request.status = "approved"
        if owner is not None:
            notify(
                db, org_id=employee.org_id, user=owner,
                category="enrolment.approved", title="Face photo approved",
                body="Your reference photo is live - check-ins now verify against it.",
                data={"request_id": str(request.id)},
            )
    else:
        request.status = "rejected"
        if owner is not None:
            notify(
                db, org_id=employee.org_id, user=owner,
                category="enrolment.rejected", title="Face photo rejected",
                body=note or "Retake and submit again from the app.",
                data={"request_id": str(request.id)},
            )
    db.flush()
    return True, None
