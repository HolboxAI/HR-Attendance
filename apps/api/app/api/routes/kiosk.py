"""Kiosk API routes for shared door / reception tablet terminal.

Allows employees to select their profile and record biometric punches
using the tablet's camera without requiring individual login sessions.
Identity is verified against the employee's enrolled reference face photo.
"""

from __future__ import annotations

import concurrent.futures
import logging
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.clock import org_today
from app.core.config import settings
from app.core.office import OFFICE
from app.db.session import get_db
from app.models.attendance import PunchEvent
from app.models.employee import Employee
from app.models.enums import PunchDirection, PunchSource
from app.models.face import FaceEnrollment
from app.services.attendance import (
    accepted_on_shift,
    next_direction,
    policy_for,
    recompute_day,
    record_punch,
)
from app.services.enrolment import reference_bytes
from app.services.face import FaceUnavailable, NOT_ENROLLED, get_face_service
from app.services.resolver import shift_date_for
from app.services.storage import punch_key, storage

log = logging.getLogger("holbox.kiosk")

def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)

def _slack_now(fn, *args) -> None:
    """Dispatch Slack notifications in a background daemon thread.
    
    Guaranteed non-blocking: never delays the kiosk UI response on the tablet.
    Safely ignored when SLACK_BOT_TOKEN is unset in local environment.
    """
    if not settings.slack_bot_token or not settings.slack_channel_id:
        return
    from threading import Thread
    try:
        Thread(target=fn, args=args, daemon=True).start()
    except Exception as e:
        log.warning("Failed to launch background Slack thread: %s", e)

router = APIRouter(prefix="/kiosk", tags=["kiosk"])

# In-memory cache for enrolled face photos to prevent repeat disk I/O on rapid punches
_REF_PHOTO_CACHE: dict[str, bytes] = {}


class KioskEmployee(BaseModel):
    id: str
    emp_code: str
    full_name: str
    avatar_url: str | None
    direction: str  # "in" or "out" (suggested next action)
    is_currently_in: bool
    is_on_break: bool
    has_enrolled_face: bool
    shift_label: str | None


class KioskPunchResponse(BaseModel):
    accepted: bool
    emp_code: str
    full_name: str
    direction: str
    punch_type: str
    punched_at: str
    face_similarity: float | None = None
    title: str | None = None
    message: str
    break_duration_minutes: int | None = None
    break_duration_str: str | None = None


@router.get("/roster", response_model=list[KioskEmployee])
def get_kiosk_roster(db: Session = Depends(get_db)) -> list[KioskEmployee]:
    """Fetch all active employees with their current attendance status.
    
    Used by the door tablet kiosk to render employee cards so employees can
    quickly tap their name.
    """
    stmt = (
        select(Employee)
        .where(Employee.deleted_at.is_(None))
        .where(Employee.is_active.is_(True))
        .order_by(Employee.full_name.asc())
    )
    employees = db.scalars(stmt).all()

    today_date = org_today()
    results: list[KioskEmployee] = []

    for emp in employees:
        policy, _ = policy_for(db, emp, today_date)
        shift_date = shift_date_for(datetime.now(timezone.utc), policy)

        # Check face enrollment
        enrol = db.scalar(
            select(FaceEnrollment)
            .where(FaceEnrollment.employee_id == emp.id)
            .where(FaceEnrollment.deleted_at.is_(None))
            .where(FaceEnrollment.is_active.is_(True))
            .order_by(FaceEnrollment.created_at.desc())
        )
        has_face = enrol is not None and bool(enrol.photo_key)
        avatar_url = f"/api/gateway/api/v1/employees/{emp.emp_code}/photo" if has_face else None

        # Next direction and current status
        next_dir = next_direction(db, emp, shift_date)
        is_in = (next_dir == PunchDirection.OUT)

        today_events = accepted_on_shift(db, emp, shift_date)
        last_event = today_events[-1] if today_events else None
        last_punch_type = (
            last_event.raw_payload.get("punch_type")
            if last_event and last_event.raw_payload
            else None
        )
        is_checked_in = len(today_events) > 0
        is_on_break = (
            not is_in
            and is_checked_in
            and last_punch_type in ("break_out", "break_start")
        )

        results.append(
            KioskEmployee(
                id=str(emp.id),
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                avatar_url=avatar_url,
                direction=next_dir.value,
                is_currently_in=is_in,
                is_on_break=is_on_break,
                has_enrolled_face=has_face,
                shift_label=f"{policy.start_time:%H:%M} - {policy.end_time:%H:%M}" if policy else None,
            )
        )

    return results


@router.post("/punch", response_model=KioskPunchResponse)
async def kiosk_punch(
    selfie: UploadFile = File(..., alias="selfie"),
    emp_code: str | None = Form(None),
    punch_type: str = Form("check_in"),
    direction: str | None = Form(None),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    accuracy_m: float | None = Form(None),
    db: Session = Depends(get_db),
) -> KioskPunchResponse:
    """Record a biometric punch from the shared tablet kiosk at the office door.
    
    Supports both:
    1. 1:N automatic face recognition (emp_code is None):
       Matches the selfie against all enrolled active employees.
    2. 1:1 verification (emp_code provided).
    """
    image = await selfie.read()
    if not image:
        raise HTTPException(400, "No image captured by tablet camera")

    now_utc = datetime.now(timezone.utc)
    face_service = get_face_service()

    emp: Employee | None = None
    face_sim: float | None = None

    if emp_code:
        # 1:1 mode
        emp = db.scalar(
            select(Employee)
            .where(Employee.emp_code == emp_code)
            .where(Employee.deleted_at.is_(None))
        )
        if not emp:
            raise HTTPException(404, f"Employee code '{emp_code}' not found")

        reference = reference_bytes(db, emp)
        if not reference:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=None,
                message="No enrolled face photo on file. Please enrol your face with HR first.",
            )

        try:
            face = face_service.verify(enrolled_bytes=reference, selfie_bytes=image)
        except FaceUnavailable as exc:
            log.warning("Biometric face check unavailable: %s", exc)
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=None,
                message="Biometric AI verification service unavailable. Please try again.",
            )

        if not face or not face.matched:
            sim_str = f" ({face.similarity:.1f}% match)" if (face and face.similarity is not None) else ""
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=face.similarity if face else None,
                message=face.reason if (face and face.reason) else f"Face not recognized{sim_str}. Please look straight into camera.",
            )
        face_sim = face.similarity
    else:
        # 1:N automatic face recognition sweep across all enrolled active employees
        # Join FaceEnrollment directly to grab photo_key in a single database query
        stmt = (
            select(Employee, FaceEnrollment.photo_key)
            .join(FaceEnrollment, FaceEnrollment.employee_id == Employee.id)
            .where(Employee.is_active.is_(True))
            .where(Employee.deleted_at.is_(None))
            .where(FaceEnrollment.is_active.is_(True))
            .where(FaceEnrollment.deleted_at.is_(None))
            .order_by(Employee.full_name.asc())
        )
        enrolled_rows = db.execute(stmt).all()

        if not enrolled_rows:
            return KioskPunchResponse(
                accepted=False,
                emp_code="",
                full_name="",
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=None,
                message="No enrolled employee face photos found in system. Please contact HR.",
            )

        # Preload reference bytes from local storage (with memory cache for sub-second sweeps)
        candidate_refs = []
        for cand_emp, photo_key in enrolled_rows:
            try:
                ref = _REF_PHOTO_CACHE.get(photo_key)
                if not ref:
                    ref = storage.get(photo_key)
                    if ref:
                        _REF_PHOTO_CACHE[photo_key] = ref
                if ref:
                    candidate_refs.append((cand_emp, ref))
            except Exception:
                continue

        best_emp: Employee | None = None
        best_sim: float = 0.0

        def compare_one(cand_emp: Employee, ref_bytes: bytes):
            try:
                res = face_service.match_candidate(
                    reference_bytes=ref_bytes,
                    selfie_bytes=image,
                    threshold=80.0,
                )
                return cand_emp, res
            except Exception as e:
                log.debug("Verification error for %s: %s", cand_emp.emp_code, e)
                return cand_emp, None

        # Fan out across candidates concurrently (all threads fire simultaneously)
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(candidate_refs), 12)) as executor:
            futures = {
                executor.submit(compare_one, c, r): c for c, r in candidate_refs
            }
            for fut in concurrent.futures.as_completed(futures):
                cand_emp, res = fut.result()
                if res and res.matched and (res.similarity or 0) > best_sim:
                    best_sim = res.similarity or 0.0
                    best_emp = cand_emp
                    # If high confidence match (>= 90%), stop immediately and return
                    if best_sim >= 90.0:
                        for f in futures:
                            f.cancel()
                        break

        if not best_emp:
            return KioskPunchResponse(
                accepted=False,
                emp_code="",
                full_name="",
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=None,
                message="Face not recognized. Please face the camera directly in good lighting, or contact HR if you haven't enrolled your face.",
            )

        emp = best_emp
        face_sim = best_sim

    policy, _ = policy_for(db, emp, org_today())
    shift_date = shift_date_for(now_utc, policy)

    # Sequence validation across punches on this shift
    # Order by event_ts_utc and created_at to guarantee stable chronological order
    all_emp_punches = list(
        db.scalars(
            select(PunchEvent)
            .where(
                and_(
                    PunchEvent.employee_id == emp.id,
                    PunchEvent.rejection_reason.is_(None),
                )
            )
            .order_by(PunchEvent.event_ts_utc.asc(), PunchEvent.created_at.asc())
        ).all()
    )
    today_punches = [
        p for p in all_emp_punches
        if shift_date_for(_aware(p.event_ts_utc), policy) == shift_date
    ]
    has_checked_in = any(
        (p.raw_payload or {}).get("punch_type") == "check_in" or p.direction == PunchDirection.IN
        for p in today_punches
    )
    last_punch = today_punches[-1] if today_punches else None
    last_type = (last_punch.raw_payload or {}).get("punch_type") if last_punch else None
    if last_type is None and last_punch is not None:
        last_type = "check_in" if last_punch.direction == PunchDirection.IN else "check_out"

    is_on_break = last_type in ("break_out", "break_start")
    is_checked_out = last_type in ("check_out", "out")
    first_name = emp.full_name.split()[0] if emp.full_name else "there"

    # Edge Case 1: Trying to check out
    if punch_type == "check_out":
        if not has_checked_in:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="out",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Check In Required",
                message=f"You haven't checked in yet today, {first_name}. Please tap Clock In first.",
            )
        if is_on_break:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="out",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Break In Required",
                message=f"You are currently on break, {first_name}. Please tap Break In to complete break before checking out.",
            )
        if is_checked_out:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="out",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Already Checked Out",
                message=f"You have already checked out for the day, {first_name}.",
            )

    # Edge Case 2: Trying to break out
    elif punch_type in ("break_out", "break_start"):
        if not has_checked_in:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="out",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Check In Required",
                message=f"You haven't checked in yet today, {first_name}. Please tap Clock In first.",
            )
        if is_on_break:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="out",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Already On Break",
                message=f"You are already on break, {first_name}. Please tap Break In to resume work.",
            )
        if is_checked_out:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="out",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Already Checked Out",
                message=f"You have already checked out for the day, {first_name}.",
            )

    # Edge Case 3: Trying to break in
    elif punch_type in ("break_in", "break_end"):
        if not has_checked_in:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Check In Required",
                message=f"You haven't checked in yet today, {first_name}. Please tap Clock In first.",
            )
        if not is_on_break:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Break Not Started",
                message=f"You haven't started a break yet, {first_name}. Tap Break Out to start a break.",
            )
        if is_checked_out:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Already Checked Out",
                message=f"You have already checked out for the day, {first_name}.",
            )

    # Edge Case 4: Trying to check in
    elif punch_type == "check_in":
        if is_on_break:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Break In Required",
                message=f"You are currently on break, {first_name}. Please tap Break In to resume work.",
            )
        if has_checked_in and not is_checked_out:
            return KioskPunchResponse(
                accepted=False,
                emp_code=emp.emp_code,
                full_name=emp.full_name,
                direction="in",
                punch_type=punch_type,
                punched_at=now_utc.isoformat(),
                face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
                title="Already Clocked In",
                message=f"You are already clocked in, {first_name}.",
            )

    # Calculate actual break duration on break_in
    break_duration_minutes: int | None = None
    break_duration_str: str | None = None
    if punch_type in ("break_in", "break_end"):
        break_outs = [
            p for p in today_punches
            if (p.raw_payload or {}).get("punch_type") in ("break_out", "break_start")
        ]
        if break_outs:
            last_bo = break_outs[-1]
            bo_time = last_bo.event_ts_utc
            if bo_time.tzinfo is None:
                bo_time = bo_time.replace(tzinfo=timezone.utc)
            sec = max(0, (now_utc - bo_time).total_seconds())
            mins = max(1, round(sec / 60))
            break_duration_minutes = mins
            if mins < 60:
                break_duration_str = f"{mins} min" if mins == 1 else f"{mins} mins"
            else:
                h = mins // 60
                m = mins % 60
                break_duration_str = f"{h}h {m}m" if m > 0 else f"{h}h"

    # Determine direction
    if punch_type in ("check_in", "break_in", "break_end"):
        punch_dir = PunchDirection.IN
    elif punch_type in ("check_out", "break_out", "break_start"):
        punch_dir = PunchDirection.OUT
    elif direction:
        punch_dir = PunchDirection.IN if direction.lower() == "in" else PunchDirection.OUT
    else:
        punch_dir = next_direction(db, emp, shift_date)

    # Store punch photo
    punch_id = uuid.uuid4()
    key = punch_key(shift_date, punch_id)
    storage.put(key, image)

    # Record punch
    event, _ = record_punch(
        db,
        org_id=emp.org_id,
        employee=emp,
        event_ts=now_utc,
        source=PunchSource.WEB_KIOSK,
        direction=punch_dir,
        lat=lat,
        lng=lng,
        photo_key=key,
        geofence_ok=True,
        distance_m=0.0,
        face_ok=True,
        face_similarity=face_sim,
        rejection_reason=None,
        raw={
            "punch_type": punch_type,
            "accuracy_m": accuracy_m,
            "kiosk_terminal": "door_ipad",
            "break_duration_minutes": break_duration_minutes,
            "break_duration_str": break_duration_str,
        },
    )

    day = recompute_day(db, emp, shift_date)
    db.commit()

    # Form friendly timestamp in local office timezone
    local_tz = ZoneInfo(str(OFFICE.get("timezone", "Asia/Kolkata")))
    local_time = now_utc.astimezone(local_tz)
    time_str = local_time.strftime("%I:%M %p").replace(" 0", " ")

    # Craft exact user-facing title and message based on shift and punch type
    if punch_type == "check_in":
        if day and day.late_minutes and day.late_minutes > 0:
            title = "Late Arrival"
            msg = "Late arrival. Your attendance has been marked."
        else:
            title = "Clocked In"
            msg = "Your attendance has been marked."
    elif punch_type == "check_out":
        title = "Clocked Out"
        msg = f"Clocked out at {time_str}."
    elif punch_type in ("break_out", "break_start"):
        title = "Break Started"
        msg = f"Started your break at {time_str}."
    elif punch_type in ("break_in", "break_end"):
        title = "Break Completed"
        if break_duration_str:
            msg = f"Completed break at {time_str} (Duration: {break_duration_str})."
        else:
            msg = f"Completed break at {time_str}."
    else:
        title = "Recorded"
        msg = "Your attendance has been marked."

    # Dispatch Slack Notifications in background (Active when SLACK_BOT_TOKEN is set on EC2)
    from app.services.slack import (
        post_break_ended_alert,
        post_break_started_alert,
        post_checkin_alert,
        post_checkout_alert,
    )

    if punch_type == "check_in":
        _slack_now(
            post_checkin_alert,
            emp.full_name,
            emp.emp_code,
            time_str,
            shift_date.isoformat(),
            day.late_minutes if day and day.late_minutes else 0,
            emp.email,
        )
    elif punch_type in ("break_out", "break_start"):
        _slack_now(
            post_break_started_alert,
            emp.full_name,
            emp.emp_code,
            time_str,
            shift_date.isoformat(),
            emp.email,
        )
    elif punch_type in ("break_in", "break_end"):
        _slack_now(
            post_break_ended_alert,
            emp.full_name,
            emp.emp_code,
            time_str,
            break_duration_minutes or 0,
            shift_date.isoformat(),
            emp.email,
        )
    elif punch_type == "check_out":
        _slack_now(
            post_checkout_alert,
            emp.full_name,
            emp.emp_code,
            time_str,
            shift_date.isoformat(),
            day.worked_minutes if day else 0,
            day.break_minutes if day else 0,
            emp.email,
        )

    return KioskPunchResponse(
        accepted=True,
        emp_code=emp.emp_code,
        full_name=emp.full_name,
        direction=punch_dir.value,
        punch_type=punch_type,
        punched_at=now_utc.isoformat(),
        face_similarity=round(face_sim, 1) if face_sim is not None else 100.0,
        title=title,
        message=msg,
        break_duration_minutes=break_duration_minutes,
        break_duration_str=break_duration_str,
    )
