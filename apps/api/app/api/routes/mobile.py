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

import calendar
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, install_id_header
from app.core.config import settings
from app.core.office import OFFICE
from app.db.session import get_db
from app.models.employee import Employee
from app.models.enums import PunchDirection, PunchSource
from app.models.org import Location
from app.services.attendance import (
    next_direction, recompute_day, record_punch,
)
from app.services import devices
from app.services.enrolment import reference_bytes
from app.services.face import NOT_ENROLLED, get_face_service
from app.services.geofence import check_presence
from app.services.resolver import shift_date_for
from app.services.storage import punch_key, storage
from app.services.attendance import policy_for

router = APIRouter(prefix="/mobile", tags=["mobile"])

MAX_SELFIE_BYTES = 8 * 1024 * 1024

# Phone clocks drift. A couple of minutes either way is not an attack, it is a
# device that has not synced NTP recently.
CLOCK_SKEW_SECONDS = 120


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


@router.get("/me", response_model=TodayResponse)
def me(
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
) -> TodayResponse:
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
    emp: Employee = Depends(get_current_employee),
    install_id: str | None = Depends(install_id_header),
    selfie: UploadFile = File(...),
    lat: float | None = Form(default=None),
    lng: float | None = Form(default=None),
    accuracy_m: float | None = Form(default=None),
    fix_age_seconds: float | None = Form(default=None),
    is_mocked: bool = Form(default=False),
    wifi_bssid: str | None = Form(default=None),
    direction: PunchDirection | None = Form(default=None),
    captured_at: datetime | None = Form(default=None),
) -> PunchResponse:
    now = datetime.now(timezone.utc)

    # `captured_at` is only sent for a punch that was taken offline and queued
    # on the phone. This is the one place a client-supplied time is allowed,
    # and it is bounded rather than trusted:
    #
    #   - absent          -> server time, exactly as before
    #   - in the future   -> the phone's clock is wrong; use server time
    #   - too far past    -> refused, and stored with that reason
    #
    # The punch_events table has always had a dual clock. event_ts_utc is when
    # it HAPPENED and received_ts_utc is when we got it, so a late sync records
    # both facts instead of pretending someone arrived two hours late.
    event_ts, queue_note, queued_seconds = now, None, 0.0
    if captured_at is not None:
        claimed = captured_at if captured_at.tzinfo else captured_at.replace(tzinfo=timezone.utc)
        queued_seconds = (now - claimed).total_seconds()
        if queued_seconds < -CLOCK_SKEW_SECONDS:
            queue_note = "Phone clock is ahead - recorded at server time"
            queued_seconds = 0.0
        elif queued_seconds > settings.max_queued_punch_hours * 3600:
            hours = settings.max_queued_punch_hours
            raise HTTPException(
                422,
                f"This punch was taken more than {hours} hours ago and is too "
                f"old to sync. Ask HR to add it as a correction.",
            )
        else:
            event_ts = claimed

    # Who is punching comes from the token and nowhere else. There is
    # deliberately no employee_code parameter on this endpoint: while one
    # existed, anyone with curl could punch as anyone, and adding auth around
    # it would have changed nothing except how secure it looked.
    if settings.require_device_binding:
        bound = devices.check(db, employee=emp, install_id=install_id)
        if not bound.ok:
            raise HTTPException(403, bound.reason or devices.NOT_BOUND)

    image = await selfie.read()
    if not image:
        raise HTTPException(400, "Selfie is empty")
    if len(image) > MAX_SELFIE_BYTES:
        raise HTTPException(413, "Selfie too large - compress before upload")

    policy, _ = policy_for(db, emp, event_ts.date())
    shift_date = shift_date_for(event_ts, policy)
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
        db, org_id=emp.org_id, employee=emp, event_ts=event_ts,
        source=PunchSource.MOBILE_APP, direction=direction,
        lat=lat, lng=lng, photo_key=key,
        geofence_ok=geo.ok, distance_m=geo.distance_m,
        face_ok=face_ok,
        face_similarity=face.similarity if face else None,
        rejection_reason=reason,
        raw={"accuracy_m": accuracy_m, "wifi": bool(geo.matched_wifi),
             "face_checked": face is not None,
             "queued": captured_at is not None,
             "queued_seconds": round(queued_seconds),
             "queue_note": queue_note},
    )

    day = recompute_day(db, emp, shift_date)
    db.commit()

    if reason:
        return PunchResponse(
            accepted=False, direction=direction, punched_at=event_ts,
            distance_m=geo.distance_m,
            face_similarity=face.similarity if face else None,
            message=reason,
        )

    # The ORG's timezone, never the server's. A UTC server would otherwise
    # tell someone in Ahmedabad they checked in five and a half hours ago.
    # Report the time it HAPPENED, not the time it synced. A punch taken in
    # the basement at 9:34 and delivered at 11:00 must say 9:34, or the
    # confirmation contradicts the record we just wrote.
    local = event_ts.astimezone(ZoneInfo(str(OFFICE["timezone"])))
    return PunchResponse(
        accepted=True, direction=direction, punched_at=event_ts,
        distance_m=geo.distance_m,
        face_similarity=face.similarity if face else None,
        message=("Checked in" if direction == PunchDirection.IN else "Checked out")
                + f" at {local:%I:%M %p}".replace(" 0", " "),
        attendance_status=day.status.value,
        worked_minutes=day.worked_minutes,
    )


@router.get("/month")
def my_month(
    year: int,
    month: int,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
) -> dict:
    """Your own attendance for a month.

    Deliberately NOT under /admin. Seeing your own record is not an
    administrative act, and routing it through the admin surface would mean
    either opening that surface to everyone or telling five of seven people
    they may not look at their own hours.
    """
    _, last = calendar.monthrange(year, month)
    days = []
    totals = {"worked_minutes": 0, "present": 0, "half_day": 0, "absent": 0,
              "late_minutes": 0, "overtime_minutes": 0}

    for d in range(1, last + 1):
        on = date(year, month, d)
        rec = recompute_day(db, emp, on)
        days.append({
            "date": on.isoformat(),
            "weekday": on.strftime("%a"),
            "status": rec.status.value,
            "first_in": rec.first_in.isoformat() if rec.first_in else None,
            "last_out": rec.last_out.isoformat() if rec.last_out else None,
            "worked_minutes": rec.worked_minutes,
            "late_minutes": rec.late_minutes,
            "overtime_minutes": rec.overtime_minutes,
            "has_exception": rec.has_exception,
            "exception_note": rec.exception_note,
        })
        totals["worked_minutes"] += rec.worked_minutes
        totals["late_minutes"] += rec.late_minutes
        totals["overtime_minutes"] += rec.overtime_minutes
        if rec.status.value in totals:
            totals[rec.status.value] += 1

    db.commit()
    return {"employee_code": emp.emp_code, "full_name": emp.full_name,
            "year": year, "month": month, "days": days, "totals": totals}
