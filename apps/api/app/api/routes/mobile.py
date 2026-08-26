"""Mobile check-in - the only way anyone punches in v1.

Verification runs cheapest-first: device/employee lookup, then presence, then
the face check. We stop at the first failure so we never pay for face
recognition on a punch that was never going to count.

Every attempt is written to punch_events, accepted or not. A rejected punch
carries its reason and is excluded from hours worked, but it stays visible to
HR. Dropping failed punches on the floor is how an attendance dispute becomes
unwinnable three months later.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.office import OFFICE
from app.db.session import get_db
from app.models.employee import Employee
from app.models.enums import PunchDirection, PunchSource
from app.models.org import Location
from app.services.attendance import (
    next_direction, recompute_day, record_punch,
)
from app.services.enrolment import reference_bytes
from app.services.face import NOT_ENROLLED, get_face_service
from app.services.geofence import check_presence
from app.services.resolver import shift_date_for
from app.services.storage import punch_key, storage
from app.services.attendance import policy_for

router = APIRouter(prefix="/mobile", tags=["mobile"])

MAX_SELFIE_BYTES = 8 * 1024 * 1024


class TodayResponse(BaseModel):
    employee_code: str
    full_name: str
    direction: PunchDirection
    checked_in_at: str | None
    checked_out_at: str | None
    worked_minutes: int
    shift_label: str
    office_name: str


class PunchResponse(BaseModel):
    accepted: bool
    direction: PunchDirection
    punched_at: datetime
    distance_m: float | None = None
    face_similarity: float | None = None
    message: str
    attendance_status: str | None = None
    worked_minutes: int | None = None


def _employee(db: Session, code: str) -> Employee:
    # TODO(auth): comes from the bearer token once auth lands. Until then the
    # app passes its employee code, which is fine for a prototype and must not
    # survive into the pilot.
    emp = db.scalar(select(Employee).where(Employee.emp_code == code))
    if emp is None:
        raise HTTPException(404, f"No employee with code {code}")
    return emp


@router.get("/me", response_model=TodayResponse)
def me(employee_code: str, db: Session = Depends(get_db)) -> TodayResponse:
    emp = _employee(db, employee_code)
    policy, _ = policy_for(db, emp, datetime.now(timezone.utc).date())
    today = shift_date_for(datetime.now(timezone.utc), policy)
    day = recompute_day(db, emp, today)
    db.commit()

    return TodayResponse(
        employee_code=emp.emp_code,
        full_name=emp.full_name,
        direction=next_direction(db, emp, today),
        checked_in_at=day.first_in.isoformat() if day.first_in else None,
        checked_out_at=day.last_out.isoformat() if day.last_out else None,
        worked_minutes=day.worked_minutes,
        shift_label=f"{policy.start_time:%H:%M} - {policy.end_time:%H:%M}",
        office_name=str(OFFICE["name"]),
    )


@router.post("/punch", response_model=PunchResponse)
async def punch(
    db: Session = Depends(get_db),
    selfie: UploadFile = File(...),
    employee_code: str = Form(...),
    lat: float | None = Form(default=None),
    lng: float | None = Form(default=None),
    accuracy_m: float | None = Form(default=None),
    fix_age_seconds: float | None = Form(default=None),
    is_mocked: bool = Form(default=False),
    wifi_bssid: str | None = Form(default=None),
    direction: PunchDirection | None = Form(default=None),
) -> PunchResponse:
    now = datetime.now(timezone.utc)
    emp = _employee(db, employee_code)

    image = await selfie.read()
    if not image:
        raise HTTPException(400, "Selfie is empty")
    if len(image) > MAX_SELFIE_BYTES:
        raise HTTPException(413, "Selfie too large - compress before upload")

    policy, _ = policy_for(db, emp, now.date())
    shift_date = shift_date_for(now, policy)
    if direction is None:
        direction = next_direction(db, emp, shift_date)

    loc = db.scalar(select(Location).where(Location.id == emp.location_id))
    office_lat = float(loc.lat) if loc and loc.lat is not None else float(OFFICE["lat"])
    office_lng = float(loc.lng) if loc and loc.lng is not None else float(OFFICE["lng"])
    radius = loc.geofence_radius_m if loc else int(OFFICE["radius_m"])

    # Store the photo first so that even a rejected attempt has evidence
    # attached to it.
    punch_id = uuid.uuid4()
    key = punch_key(shift_date, punch_id)
    storage.put(key, image)

    geo = check_presence(
        lat=lat, lng=lng, office_lat=office_lat, office_lng=office_lng,
        radius_m=radius, accuracy_m=accuracy_m, fix_age_seconds=fix_age_seconds,
        is_mocked=is_mocked, wifi_bssid=wifi_bssid,
        allowed_bssids=tuple(OFFICE["allowed_bssids"]), policy=OFFICE["policy"],
    )

    face = None
    face_ok: bool | None = None
    reason: str | None = None
    if not geo.ok:
        reason = geo.reason
    else:
        reference = reference_bytes(db, emp)
        if not reference:
            # Nobody to compare against. There are exactly two honest outcomes
            # here and we must not invent a third: refuse the punch, or let it
            # through with the face check recorded as NOT PERFORMED (face_ok
            # stays NULL). This used to pass b"" to the stub and store
            # face_ok=True - a match against no one, indistinguishable in the
            # database from a real one.
            if settings.require_face_enrolment:
                reason = NOT_ENROLLED
        else:
            face = get_face_service().verify(
                enrolled_bytes=reference, selfie_bytes=image
            )
            face_ok = face.matched
            if not face.matched:
                reason = face.reason or "Face check failed"

    record_punch(
        db, org_id=emp.org_id, employee=emp, event_ts=now,
        source=PunchSource.MOBILE_APP, direction=direction,
        lat=lat, lng=lng, photo_key=key,
        geofence_ok=geo.ok, distance_m=geo.distance_m,
        face_ok=face_ok,
        face_similarity=face.similarity if face else None,
        rejection_reason=reason,
        raw={"accuracy_m": accuracy_m, "wifi": bool(geo.matched_wifi),
             "face_checked": face is not None},
    )

    day = recompute_day(db, emp, shift_date)
    db.commit()

    if reason:
        return PunchResponse(
            accepted=False, direction=direction, punched_at=now,
            distance_m=geo.distance_m,
            face_similarity=face.similarity if face else None,
            message=reason,
        )

    # The ORG's timezone, never the server's. A UTC server would otherwise
    # tell someone in Ahmedabad they checked in five and a half hours ago.
    local = now.astimezone(ZoneInfo(str(OFFICE["timezone"])))
    return PunchResponse(
        accepted=True, direction=direction, punched_at=now,
        distance_m=geo.distance_m,
        face_similarity=face.similarity if face else None,
        message=("Checked in" if direction == PunchDirection.IN else "Checked out")
                + f" at {local:%I:%M %p}".replace(" 0", " "),
        attendance_status=day.status.value,
        worked_minutes=day.worked_minutes,
    )
