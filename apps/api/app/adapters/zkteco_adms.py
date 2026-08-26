"""PARKED - gate hardware adapter.

Decision (Aug 2026): no biometric gate reader for v1. Capture is the mobile app
instead. This file is kept intact because the ingest core is device-agnostic -
if a reader is ever bought, import `adms` in main.py and it works. Nothing else
changes.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.enums import PunchDirection, PunchSource
from app.schemas.punch import PunchIn
from app.api.routes.ingest import _store

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
