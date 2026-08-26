"""Punch ingestion.

Two entry points, one destination:

  POST {prefix}/ingest/punch      - our own normalized shape (mobile, kiosk, relay)
  POST /iclock/cdata              - raw ZKTeco/eSSL ADMS, spoken by the gate reader

Both end at `_store()`. Adding a new vendor means writing a parser, not touching
anything below it.
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


# --------------------------------------------------------------------------
# ZKTeco / eSSL ADMS adapter.
#
# These readers push over plain HTTP to a fixed path and expect literal "OK"
# back. The protocol is undocumented and ugly; it is contained entirely here.
# --------------------------------------------------------------------------

adms = APIRouter(prefix="/iclock", tags=["adms"])


@adms.get("/cdata")
def adms_handshake(SN: str = "") -> str:
    """Device boots and asks for its config. Reply shape is fixed by the vendor."""
    return (
        f"GET OPTION FROM: {SN}\r\n"
        "ATTLOGStamp=None\r\nOPERLOGStamp=9999\r\nErrorDelay=30\r\n"
        "Delay=10\r\nTransTimes=00:00;14:05\r\nTransInterval=1\r\n"
        "TransFlag=1111000000\r\nRealtime=1\r\nEncrypt=0\r\n"
    )


@adms.post("/cdata")
async def adms_upload(request: Request, SN: str = "", table: str = "",
                      db: Session = Depends(get_db)) -> str:
    """Punch upload. Body is tab-separated lines:

        <device_user_id>\t<YYYY-MM-DD HH:MM:SS>\t<status>\t<verify>\t...
    """
    body = (await request.body()).decode("utf-8", errors="replace")
    punches: list[PunchIn] = []
    for line in body.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        try:
            ts = datetime.strptime(parts[1].strip(), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        punches.append(PunchIn(
            device_serial=SN,
            device_user_id=parts[0].strip(),
            event_ts=ts.replace(tzinfo=timezone.utc),   # normalized against device tz on store
            direction=PunchDirection.UNKNOWN,
            source=PunchSource.GATE_DEVICE,
            raw={"line": line, "table": table},
        ))
    if punches:
        _store(db, punches)
    return f"OK: {len(punches)}"


@adms.get("/getrequest")
def adms_poll(SN: str = "") -> str:
    """Device polls for commands (enroll a user, sync time). Nothing queued yet."""
    return "OK"
