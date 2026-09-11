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
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, install_id_header
from app.core.clock import org_today
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
from app.services.face import NOT_ENROLLED, FaceUnavailable, get_face_service
from app.services.geofence import PresencePolicy, check_presence
from app.services.resolver import shift_bounds, shift_date_for
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
    late_minutes: int = 0
    shift_label: str
    shift_start: str | None = None
    shift_end: str | None = None
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
    policy, _ = policy_for(db, emp, org_today())
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
        late_minutes=day.late_minutes,
        shift_label=f"{policy.start_time:%H:%M} - {policy.end_time:%H:%M}",
        shift_start=f"{policy.start_time:%H:%M}",
        shift_end=f"{policy.end_time:%H:%M}",
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
    if install_id:
        devices.check(db, employee=emp, install_id=install_id)

    image = await selfie.read()
    if not image:
        raise HTTPException(400, "Selfie is empty")
    if len(image) > MAX_SELFIE_BYTES:
        raise HTTPException(413, "Selfie too large - compress before upload")

    policy, _ = policy_for(db, emp, event_ts.date())
    shift_date = shift_date_for(event_ts, policy)
    if direction is None:
        direction = next_direction(db, emp, shift_date)

    # Every presence input comes from the location row, with app/core/office.py
    # only as the fallback for a database that predates it. That constant used
    # to supply the BSSID list and the policy directly, which meant registering
    # an access point was a code edit and a restart - the exact thing the PRD
    # rules out ("changeable per location without code deployment").
    loc = db.scalar(select(Location).where(Location.id == emp.location_id))
    office_lat = float(loc.lat) if loc and loc.lat is not None else float(OFFICE["lat"])
    office_lng = float(loc.lng) if loc and loc.lng is not None else float(OFFICE["lng"])
    radius = loc.geofence_radius_m if loc else int(OFFICE["radius_m"])
    allowed_bssids = tuple(loc.allowed_bssids or ()) if loc else tuple(OFFICE["allowed_bssids"])
    policy = PresencePolicy(loc.presence_policy) if loc else OFFICE["policy"]

    # Store the photo first so that even a rejected attempt has evidence
    # attached to it.
    punch_id = uuid.uuid4()
    key = punch_key(shift_date, punch_id)
    storage.put(key, image)

    is_wfh = emp.is_wfh_enabled
    if not is_wfh:
        from sqlalchemy import and_
        from app.models.wfh_request import WFHRequest
        from app.models.enums import CorrectionStatus
        wfh_req = db.scalar(
            select(WFHRequest).where(
                and_(
                    WFHRequest.employee_id == emp.id,
                    WFHRequest.shift_date == shift_date,
                    WFHRequest.status == CorrectionStatus.APPROVED,
                )
            )
        )
        if wfh_req:
            is_wfh = True

    if is_wfh:
        if lat is None or lng is None:
            from app.services.geofence import GeoCheck
            geo = GeoCheck(ok=False, distance_m=None, reason="GPS location is required for WFH", matched_wifi=False)
        else:
            from app.services.geofence import GeoCheck
            geo = GeoCheck(ok=True, distance_m=None, reason=None, matched_wifi=False)
    else:
        geo = check_presence(
            lat=lat, lng=lng, office_lat=office_lat, office_lng=office_lng,
            radius_m=radius, accuracy_m=accuracy_m, fix_age_seconds=fix_age_seconds,
            is_mocked=is_mocked, wifi_bssid=wifi_bssid,
            allowed_bssids=allowed_bssids, policy=policy,
        )

    face = None
    face_ok: bool | None = None
    face_unavailable: str | None = None
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
            try:
                face = get_face_service().verify(
                    enrolled_bytes=reference, selfie_bytes=image
                )
            except FaceUnavailable as exc:
                # Rekognition is down, throttling, or misconfigured. This is
                # OUR failure, not the employee's, so it must not become a
                # rejected punch on their record - and it must not 500 either,
                # because the selfie is already stored and an exception here
                # would leave a photo on disk with no punch_events row
                # explaining it. That is the one thing this pipeline is not
                # allowed to do.
                #
                # face_ok stays NULL: the check did not run. Same shape as the
                # no-reference-photo branch above, and for the same reason -
                # never record a verdict that was never reached.
                face_unavailable = str(exc)
                if settings.require_face_enrolment:
                    # Strict mode says a punch must be face-verified. If we
                    # cannot verify, we cannot accept.
                    reason = "Face check unavailable - try again in a moment"
            else:
                face_ok = face.matched
                if not face.matched:
                    reason = face.reason or "Face check failed"

    event, created = record_punch(
        db, org_id=emp.org_id, employee=emp, event_ts=event_ts,
        source=PunchSource.MOBILE_APP, direction=direction,
        lat=lat, lng=lng, photo_key=key,
        geofence_ok=geo.ok, distance_m=geo.distance_m,
        face_ok=face_ok,
        face_similarity=face.similarity if face else None,
        rejection_reason=reason,
        raw={"accuracy_m": accuracy_m, "wifi": bool(geo.matched_wifi),
             "face_checked": face is not None,
             "face_unavailable": face_unavailable,
             "queued": captured_at is not None,
             "queued_seconds": round(queued_seconds),
             "queue_note": queue_note},
    )

    if not created:
        # A replay of a punch we already hold. Nothing changed, so nothing is
        # recomputed - and the answer comes from the STORED event, not from
        # this request's inputs. The old path rebuilt the message from the
        # request and once said "Checked out" for a punch it had just thrown
        # away as a duplicate.
        db.commit()
        stored_local = event.event_ts_utc
        if stored_local.tzinfo is None:
            stored_local = stored_local.replace(tzinfo=timezone.utc)
        stored_local = stored_local.astimezone(ZoneInfo(str(OFFICE["timezone"])))
        return PunchResponse(
            accepted=event.rejection_reason is None,
            direction=event.direction,
            punched_at=event.event_ts_utc,
            distance_m=float(event.distance_m) if event.distance_m is not None else None,
            face_similarity=float(event.face_similarity) if event.face_similarity is not None else None,
            message=(event.rejection_reason
                     or ("Already recorded - "
                         + ("checked in" if event.direction == PunchDirection.IN else "checked out")
                         + f" at {stored_local:%I:%M %p}".replace(" 0", " "))),
        )

    day = recompute_day(db, emp, shift_date)
    db.commit()

    if reason:
        return PunchResponse(
            accepted=False,
            direction=direction,
            punched_at=event_ts,
            distance_m=geo.distance_m,
            face_similarity=face.similarity if face else None,
            message=reason,
        )

    local_tz = ZoneInfo(str(OFFICE["timezone"]))
    local = event_ts.astimezone(local_tz)
    punch_time_str = local.strftime('%I:%M %p').replace(" 0", " ")

    # Only fire Late Arrival alert on the FIRST accepted IN punch of the day
    if direction == PunchDirection.IN and day.punch_count == 1 and day.late_minutes > 0:
        from app.services.notifications import notify_hr
        notify_hr(
            db,
            org_id=emp.org_id,
            category="attendance.late_arrival",
            title=f"Late Arrival: {emp.full_name}",
            body=f"{emp.full_name} arrived late at {punch_time_str} ({day.late_minutes} minutes late) for their shift on {shift_date.isoformat()}.",
            data={"employee_code": emp.emp_code, "shift_date": shift_date.isoformat()}
        )
        from app.services.slack import post_late_arrival_alert
        from threading import Thread
        Thread(target=post_late_arrival_alert, args=(emp.full_name, punch_time_str, day.late_minutes, shift_date.isoformat()), daemon=True).start()
        db.commit()

    # Only fire Early Leave alert on an accepted OUT punch that occurs before shift end
    elif direction == PunchDirection.OUT:
        policy, _ = policy_for(db, emp, shift_date)
        scheduled_start, scheduled_end = shift_bounds(policy, shift_date)
        early_seconds = (scheduled_end - local).total_seconds()
        early_minutes = max(0, int(early_seconds // 60))

        if early_minutes > 0:
            from app.services.notifications import notify_hr
            notify_hr(
                db,
                org_id=emp.org_id,
                category="attendance.early_leave",
                title=f"Early Leave: {emp.full_name}",
                body=f"{emp.full_name} left early at {punch_time_str} ({early_minutes} minutes early) for their shift on {shift_date.isoformat()}.",
                data={"employee_code": emp.emp_code, "shift_date": shift_date.isoformat()}
            )
            from app.services.slack import post_early_leave_alert
            from threading import Thread
            Thread(target=post_early_leave_alert, args=(emp.full_name, punch_time_str, early_minutes, shift_date.isoformat()), daemon=True).start()
            db.commit()

    return PunchResponse(
        accepted=True,
        direction=direction,
        punched_at=event_ts,
        distance_m=geo.distance_m,
        face_similarity=face.similarity if face else None,
        message=("Checked in" if direction == PunchDirection.IN else "Checked out")
                + f" at {punch_time_str}",
        attendance_status=day.status.value,
        worked_minutes=day.worked_minutes,
    )


class EnrolmentStatusResponse(BaseModel):
    enrolled: bool
    pending: bool
    last_decision: str | None
    last_note: str | None


@router.get("/enrolment", response_model=EnrolmentStatusResponse)
def my_enrolment(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
) -> EnrolmentStatusResponse:
    from sqlalchemy import select as _select

    from app.models.face import EnrolmentRequest
    from app.services.enrolment import active_enrolment

    rows = db.scalars(
        _select(EnrolmentRequest)
        .where(EnrolmentRequest.employee_id == emp.id)
        .order_by(EnrolmentRequest.created_at.desc())
    ).all()
    latest = rows[0] if rows else None
    decided = next((r for r in rows if r.status in ("approved", "rejected")), None)
    return EnrolmentStatusResponse(
        enrolled=active_enrolment(db, emp) is not None,
        pending=latest is not None and latest.status == "pending",
        last_decision=decided.status if decided else None,
        last_note=decided.note if decided else None,
    )


@router.post("/enrolment", response_model=EnrolmentStatusResponse)
async def submit_enrolment_photo(
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
    photo: UploadFile = File(...),
) -> EnrolmentStatusResponse:
    """Offer your own photo as reference photo.

    First-time enrolments for new employees are verified for biometric quality and
    auto-approved immediately so the employee does not have to wait for admin approval
    to start punching. Subsequent changes submit a replacement request for HR review.
    """
    from datetime import datetime, timezone
    import uuid
    from app.models.face import EnrolmentRequest
    from app.services.enrolment import active_enrolment, enrol, submit_request

    image = await photo.read()
    current = active_enrolment(db, emp)

    if current is None:
        # First-time enrolment: Auto-approve & immediately activate!
        record, quality = enrol(db, employee=emp, image=image)
        if record is None:
            raise HTTPException(422, quality.reason or "That photo cannot be used")

        # Record in EnrolmentRequest audit log as auto-approved
        req = EnrolmentRequest(
            id=uuid.uuid4(),
            org_id=emp.org_id,
            employee_id=emp.id,
            photo_key=record.photo_key,
            status="approved",
            decided_at=datetime.now(timezone.utc),
            note="Initial self-enrolment on onboarding (auto-approved)",
        )
        db.add(req)
        db.commit()
        return my_enrolment(db=db, emp=emp)

    # Existing enrollment: Submit replacement request for HR vouching
    request, quality = submit_request(db, employee=emp, image=image)
    if request is None:
        raise HTTPException(422, quality.reason or "That photo cannot be used")
    db.commit()
    return my_enrolment(db=db, emp=emp)


@router.delete("/enrolment", response_model=EnrolmentStatusResponse)
def cancel_enrolment_request(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
) -> EnrolmentStatusResponse:
    from app.services.enrolment import cancel_request
    if cancel_request(db, emp):
        db.commit()
    return my_enrolment(db=db, emp=emp)


class RegisterDeviceRequest(BaseModel):
    platform: str = "web"
    model: str | None = None


@router.post("/register-device")
def register_device(
    body: RegisterDeviceRequest,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
    install_id: str | None = Depends(install_id_header),
) -> dict:
    """Bind THIS device to the signed-in employee, outside of login.

    Login has always done this binding as a side effect, which works for the
    phone - it signs in exactly once. The dashboard cannot: its session
    deliberately never carries an install id (a browser must not consume the
    handset slot just by signing in), so the check-in page had no way to
    recover from "this phone is not registered" except sending the person to
    HR. Same rules as login - one handset per person, a conflict is refused
    with the same wording, and taking over a device someone else retired is
    allowed. HR clearing a binding still works exactly as before.
    """
    if not install_id:
        raise HTTPException(422, "Send the device identity in X-Install-Id")
    result = devices.bind(
        db, employee=emp, install_id=install_id,
        platform=body.platform, model=body.model,
    )
    if not result.ok:
        raise HTTPException(409, result.reason or "Refused")
    db.commit()
    return {"bound": True, "employee_code": emp.emp_code}


class PushTokenRequest(BaseModel):
    push_token: str = Field(min_length=10, max_length=400)


@router.post("/push-token")
def register_push_token(
    body: PushTokenRequest,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
    install_id: str | None = Depends(install_id_header),
) -> dict:
    """Attach this phone's push address to its device binding.

    The token goes on the MobileDevice row for THIS install, not on the
    employee - the binding row is what already answers "which handset is
    theirs", and a token stored anywhere else could outlive the phone it
    belongs to. Re-registering after a token rotation just overwrites; a
    phone HR unbound cannot re-attach (its row is inactive) until the
    person signs in again, which re-binds through the same front door.
    """
    if not install_id:
        raise HTTPException(422, "Send the device identity in X-Install-Id")
    from app.models.face import MobileDevice
    device = db.scalar(select(MobileDevice).where(
        MobileDevice.employee_id == emp.id,
        MobileDevice.install_id == install_id,
        MobileDevice.is_active.is_(True),
    ))
    if device is None:
        raise HTTPException(409, "This phone is not registered - sign in on it first")
    device.push_token = body.push_token
    db.commit()
    return {"stored": True, "employee_code": emp.emp_code}


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
            "has_exception": rec.has_exception,
            "exception_note": rec.exception_note,
            "is_regularized": rec.is_regularized,
        })
        totals["worked_minutes"] += rec.worked_minutes
        totals["late_minutes"] += rec.late_minutes
        totals["overtime_minutes"] += rec.overtime_minutes
        if rec.status.value in totals:
            totals[rec.status.value] += 1

    db.commit()
    return {"employee_code": emp.emp_code, "full_name": emp.full_name,
            "year": year, "month": month, "days": days, "totals": totals}


class MobileHoliday(BaseModel):
    id: uuid.UUID
    day: date
    name: str
    is_optional: bool
    is_confirmed: bool


@router.get("/holidays", response_model=list[MobileHoliday])
def my_holidays(
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
) -> list[MobileHoliday]:
    """Upcoming holidays for the employee."""
    from app.models.leave import Holiday
    
    rows = db.scalars(
        select(Holiday).where(
            Holiday.org_id == emp.org_id,
            Holiday.day >= date.today(),
            Holiday.deleted_at.is_(None),
        ).order_by(Holiday.day)
    ).all()
    
    return [
        MobileHoliday(
            id=r.id, day=r.day, name=r.name,
            is_optional=r.is_optional, is_confirmed=r.is_confirmed
        ) for r in rows
    ]
