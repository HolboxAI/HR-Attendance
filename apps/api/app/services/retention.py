"""Deleting biometric data on schedule.

The PRD makes two promises about photos and both need a job behind them or
they are decoration:

- punch selfies are deleted after 90 days
- an employee's reference photo goes when they leave

What this deletes is FILES, never rows. `punch_events` is append-only; the
punch, its verification result and its rejection reason all survive. Only the
image goes, and `photo_key` stays behind as the record that an image once
existed and where. Readers already cope with a missing file - see
`reference_bytes` in enrolment.py, which treats a vanished photo as "not
enrolled" rather than as a match.

Every run writes an audit row with what it removed, because "where did that
photo go" must have an answer that is not "we think a cron ate it".
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.employee import Employee, User
from app.models.face import FaceEnrollment
from app.services.leave import audit
from app.services.storage import storage

# punches/2026-08-26/<uuid>.jpg - the date folder is what makes a purge cheap.
PUNCH_DAY = re.compile(r"^punches/(\d{4}-\d{2}-\d{2})/")


@dataclass
class Sweep:
    cutoff: date | None = None
    deleted: int = 0
    bytes_freed: int = 0
    keys: list[str] = field(default_factory=list)
    dry_run: bool = True

    @property
    def summary(self) -> str:
        what = "would delete" if self.dry_run else "deleted"
        mb = self.bytes_freed / (1024 * 1024)
        return f"{what} {self.deleted} file(s), {mb:.1f} MB"


def purge_punch_selfies(
    *, older_than_days: int | None = None, today: date | None = None,
    dry_run: bool = True,
) -> Sweep:
    """Remove punch selfies past their retention window.

    Reads the date straight off the key rather than querying punch_events. The
    files are the thing being aged out, and a photo whose row was somehow lost
    should still be deleted rather than living forever because nothing
    referenced it.
    """
    days = older_than_days if older_than_days is not None else settings.punch_selfie_retention_days
    today = today or datetime.now(timezone.utc).date()
    cutoff = today - timedelta(days=days)

    sweep = Sweep(cutoff=cutoff, dry_run=dry_run)
    for key in storage.keys_under("punches"):
        match = PUNCH_DAY.match(key)
        if match is None:
            continue                      # not a dated punch folder; leave it alone
        try:
            day = date.fromisoformat(match.group(1))
        except ValueError:
            continue
        if day >= cutoff:
            continue

        sweep.keys.append(key)
        sweep.deleted += 1
        if dry_run:
            path = storage.path_for(key)
            sweep.bytes_freed += path.stat().st_size if path.is_file() else 0
        else:
            sweep.bytes_freed += storage.delete(key)
    return sweep


def purge_reference_photos(
    db: Session, *, today: date | None = None, dry_run: bool = True,
) -> Sweep:
    """Remove reference photos for people who have left.

    Applies to every enrolment row the person ever had, not just the active
    one: superseded photos are still their face. The rows stay - who enrolled
    whom and when is exactly the history worth keeping - but the images go.
    """
    today = today or datetime.now(timezone.utc).date()
    grace = timedelta(days=settings.reference_photo_days_after_exit)
    sweep = Sweep(dry_run=dry_run)

    leavers = db.scalars(
        select(Employee).where(Employee.date_of_exit.isnot(None))
    ).all()
    for emp in leavers:
        if emp.date_of_exit is None or emp.date_of_exit + grace > today:
            continue
        rows = db.scalars(
            select(FaceEnrollment).where(FaceEnrollment.employee_id == emp.id)
        ).all()
        for row in rows:
            if not storage.exists(row.photo_key):
                continue
            sweep.keys.append(row.photo_key)
            sweep.deleted += 1
            if dry_run:
                sweep.bytes_freed += storage.path_for(row.photo_key).stat().st_size
            else:
                sweep.bytes_freed += storage.delete(row.photo_key)
                # No longer usable for comparison, and saying so beats leaving
                # a row that claims an active enrolment with no photo.
                row.is_active = False
    return sweep


def run(
    db: Session, *, org_id: uuid.UUID, actor: User | None = None,
    today: date | None = None, dry_run: bool = True,
) -> dict:
    """Both sweeps, plus the audit row that explains what happened."""
    selfies = purge_punch_selfies(today=today, dry_run=dry_run)
    references = purge_reference_photos(db, today=today, dry_run=dry_run)

    if not dry_run and (selfies.deleted or references.deleted):
        audit(
            db, org_id=org_id, actor=actor, entity="photo_retention",
            entity_id=None, action="purge",
            changes={
                "punch_selfies": {"old": selfies.deleted, "new": 0},
                "reference_photos": {"old": references.deleted, "new": 0},
            },
            note=(f"selfies older than {selfies.cutoff}; "
                  f"reference photos for leavers past "
                  f"{settings.reference_photo_days_after_exit} days"),
        )
        db.commit()

    return {
        "dry_run": dry_run,
        "punch_selfies": {"deleted": selfies.deleted, "bytes": selfies.bytes_freed,
                          "cutoff": selfies.cutoff.isoformat() if selfies.cutoff else None},
        "reference_photos": {"deleted": references.deleted, "bytes": references.bytes_freed},
    }
