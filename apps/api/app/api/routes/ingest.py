"""Punch ingestion.

Every capture method lands in `_store()`. Today that means the mobile app; a
gate reader adapter sits parked in app/adapters/zkteco_adms.py if we ever want
one. The core does not know or care which produced a punch.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.enums import PunchDirection, PunchSource
from app.schemas.punch import PunchAccepted, PunchBatchIn, PunchIn

router = APIRouter(tags=["ingest"])


def dedupe_hash(device_serial: str | None, device_user_id: str | None,
                employee_code: str | None, ts: datetime) -> str:
    """Idempotency key.

    A reader replaying its offline buffer will send the same punch many times.
    Same identity + same second = same row. The UNIQUE index does the rest.
    """
    key = f"{device_serial or ''}|{device_user_id or ''}|{employee_code or ''}|{ts.astimezone(timezone.utc).isoformat(timespec='seconds')}"
    return hashlib.sha256(key.encode()).hexdigest()


def _store(db: Session, punches: list[PunchIn]) -> PunchAccepted:
    """TODO(next): resolve employee, insert ON CONFLICT DO NOTHING, queue resolver.

    Deliberately kept as one narrow function so the vendor adapters above it
    stay dumb translators.
    """
    accepted = duplicates = unmatched = 0
    dates: set[str] = set()
    for p in punches:
        _ = dedupe_hash(p.device_serial, p.device_user_id, p.employee_code, p.event_ts)
        dates.add(p.event_ts.date().isoformat())
        accepted += 1
    return PunchAccepted(
        accepted=accepted, duplicates=duplicates,
        unmatched=unmatched, affected_dates=sorted(dates),
    )


@router.post("/ingest/punch", response_model=PunchAccepted)
def ingest_punch(
    body: PunchBatchIn,
    db: Session = Depends(get_db),
    x_device_key: str | None = Header(default=None),
) -> PunchAccepted:
    if not body.punches:
        raise HTTPException(400, "No punches in payload")
    return _store(db, body.punches)
