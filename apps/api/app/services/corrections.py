"""The employee-initiated half of fixing an attendance day.

routes/admin.py already has POST /admin/correct: HR types in a punch directly,
audited, and it has been there since M3. That path still exists and still has
its place - a bulk backfill, or HR acting on a phone call. What it cannot be is
the whole story, because on that path HR is both the person asking and the
person deciding, and the PRD (section 11) wants the person who was actually
there to be the one who asks.

So this module is a REQUEST wrapped around the same mechanism. Approving one
calls record_punch exactly the way the direct path does - same MANUAL source,
same audit shape - the only new thing is that a human other than the requester
looks at it first.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.correction import CorrectionRequest
from app.models.employee import Employee, User
from app.models.enums import CorrectionStatus, PunchDirection, PunchSource
from app.services import notifications
from app.services.attendance import record_punch, recompute_day
from app.services.leave import audit


@dataclass(frozen=True)
class CorrectionOutcome:
    ok: bool
    request: CorrectionRequest | None = None
    reason: str | None = None


def overlapping(
    db: Session, employee: Employee, shift_date: date, direction: PunchDirection,
    exclude: uuid.UUID | None = None,
) -> CorrectionRequest | None:
    """A live request for the same day and direction.

    Pending counts as live, same reasoning as leave: two requests for "what
    time I left on the 4th" must not both be sitting there for someone to
    approve twice.
    """
    stmt = select(CorrectionRequest).where(
        CorrectionRequest.employee_id == employee.id,
        CorrectionRequest.shift_date == shift_date,
        CorrectionRequest.direction == direction,
        CorrectionRequest.status.in_([CorrectionStatus.PENDING, CorrectionStatus.APPROVED]),
        CorrectionRequest.deleted_at.is_(None),
    )
    if exclude is not None:
        stmt = stmt.where(CorrectionRequest.id != exclude)
    return db.scalar(stmt)


def submit(
    db: Session, *, employee: Employee, shift_date: date, direction: PunchDirection,
    claimed_at: datetime, reason: str, today: date | None = None,
) -> CorrectionOutcome:
    today = today or datetime.now(timezone.utc).date()

    if not reason.strip():
        return CorrectionOutcome(False, reason="A correction needs a reason")
    if shift_date > today:
        return CorrectionOutcome(False, reason="Cannot correct a day that has not happened yet")

    clash = overlapping(db, employee, shift_date, direction)
    if clash is not None:
        return CorrectionOutcome(
            False,
            reason=f"You already have a {clash.status.value} request for "
                   f"{shift_date} ({direction.value})",
        )

    row = CorrectionRequest(
        id=uuid.uuid4(), org_id=employee.org_id, employee_id=employee.id,
        shift_date=shift_date, direction=direction, claimed_at=claimed_at,
        reason=reason.strip(), status=CorrectionStatus.PENDING,
    )
    db.add(row)
    db.flush()

    notifications.notify_hr(
        db, org_id=employee.org_id, category="correction.submitted",
        title=f"{employee.full_name} needs a correction",
        body=f"{shift_date} · {direction.value} · {reason.strip()}",
        data={"correction_id": str(row.id), "employee_code": employee.emp_code},
    )
    return CorrectionOutcome(True, request=row)


def decide(
    db: Session, *, request: CorrectionRequest, actor: User, approve: bool,
    note: str | None = None,
) -> CorrectionOutcome:
    """Approve or reject. Approving creates the punch and recomputes the day
    inside this call, so a route can never forget to."""
    if request.status != CorrectionStatus.PENDING:
        return CorrectionOutcome(False, reason=f"That request is already {request.status.value}")

    # Same rule as leave, for the same reason: an hr_admin who could approve
    # their own correction is not a review, it is a formality.
    if actor.employee_id is not None and actor.employee_id == request.employee_id:
        return CorrectionOutcome(False, reason="You cannot decide your own correction")

    employee = db.get(Employee, request.employee_id)

    if approve:
        # The CLAIMED time becomes the punch time - that is what a correction
        # is. Server time is authoritative for punches nobody has vouched for;
        # here a second human has looked at the claim and approved it, which is
        # the same trade POST /admin/correct has always made with body.at.
        # Stamping it "now" would file the punch against today and leave the
        # day being corrected exactly as broken as it was.
        event, _created = record_punch(
            db, org_id=request.org_id, employee=employee,
            event_ts=request.claimed_at, source=PunchSource.MANUAL,
            direction=request.direction,
            raw={
                "correction_request_id": str(request.id),
                "claimed_at": request.claimed_at.isoformat(),
                "reason": request.reason,
                "actor": actor.email,
            },
        )
        request.punch_event_id = event.id
        request.status = CorrectionStatus.APPROVED
    else:
        request.status = CorrectionStatus.REJECTED

    request.decided_by = actor.id
    request.decided_at = datetime.now(timezone.utc)
    request.decided_note = note
    db.flush()

    audit(db, org_id=request.org_id, actor=actor, entity="correction_request",
          entity_id=request.id, action="approve" if approve else "reject",
          changes={"status": {"old": "pending", "new": request.status.value}}, note=note)

    if approve:
        recompute_day(db, employee, request.shift_date)

    # An employee with no login yet has nowhere to receive this - the row
    # simply is not created, rather than notifying a user that does not exist.
    owner = _owning_user(db, employee)
    if owner is not None:
        notifications.notify(
            db, org_id=request.org_id, user=owner,
            category=f"correction.{request.status.value}",
            title="Correction approved" if approve else "Correction rejected",
            body=note or (f"Your {request.shift_date} correction was approved"
                          if approve else f"Your {request.shift_date} correction was rejected"),
            data={"correction_id": str(request.id)},
        )

    return CorrectionOutcome(True, request=request)


def cancel(db: Session, *, request: CorrectionRequest, actor: User) -> CorrectionOutcome:
    if request.status != CorrectionStatus.PENDING:
        return CorrectionOutcome(False, reason=f"That request is already {request.status.value}")
    if actor.employee_id != request.employee_id:
        return CorrectionOutcome(False, reason="You can only cancel your own request")

    request.status = CorrectionStatus.CANCELLED
    request.cancelled_at = datetime.now(timezone.utc)
    db.flush()
    audit(db, org_id=request.org_id, actor=actor, entity="correction_request",
          entity_id=request.id, action="cancel",
          changes={"status": {"old": "pending", "new": "cancelled"}})
    return CorrectionOutcome(True, request=request)


def _owning_user(db: Session, employee: Employee) -> User | None:
    return db.scalar(select(User).where(User.employee_id == employee.id))
