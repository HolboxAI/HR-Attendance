from __future__ import annotations

from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, get_current_user
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.face import EnrolmentRequest
from app.services.enrolment import active_enrolment, enrol
from app.services.storage import storage

router = APIRouter(tags=["profile"])


def _find_employee(db: Session, code_or_email: str) -> Employee:
    if "@" in code_or_email:
        emp = db.scalar(select(Employee).where(Employee.email == code_or_email.lower()))
    else:
        emp = db.scalar(select(Employee).where(Employee.emp_code == code_or_email))
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No employee found with code {code_or_email}")
    return emp


@router.get("/employees/{code_or_email}/photo")
def get_employee_photo(code_or_email: str, db: Session = Depends(get_db)):
    """Fetch an employee's active reference/profile photo."""
    emp = _find_employee(db, code_or_email)
    current = active_enrolment(db, emp)
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{code_or_email} has no reference photo")
    try:
        data = storage.get(current.photo_key)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The photo file is missing from storage")

    media = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
    return Response(content=data, media_type=media, headers={"Cache-Control": "public, max-age=300"})


@router.get("/profile/photo")
def get_my_photo(
    emp: Employee = Depends(get_current_employee),
    db: Session = Depends(get_db),
):
    """Fetch the currently logged in employee's profile photo."""
    current = active_enrolment(db, emp)
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No profile photo uploaded yet")
    try:
        data = storage.get(current.photo_key)
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The photo file is missing")

    media = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
    return Response(content=data, media_type=media, headers={"Cache-Control": "no-store"})


@router.post("/profile/photo")
async def update_my_photo(
    photo: UploadFile = File(...),
    emp: Employee = Depends(get_current_employee),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload and immediately activate a new profile/reference photo for the caller."""
    image = await photo.read()
    if not image:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No image file provided")

    record, result = enrol(db, employee=emp, image=image, actor_id=user.id)
    if record is None:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, result.reason or "Photo rejected by biometric quality check")

    # Record auto-approved request in EnrolmentRequest audit log
    req_row = EnrolmentRequest(
        id=uuid.uuid4(),
        employee_id=emp.id,
        photo_key=record.photo_key,
        status="approved",
        actor_id=user.id,
        decided_at=datetime.now(timezone.utc),
        note="Updated via web portal profile",
    )
    db.add(req_row)
    db.commit()

    ts = int(datetime.now(timezone.utc).timestamp())
    return {
        "ok": True,
        "message": "Profile photo updated successfully",
        "avatar_url": f"/api/gateway/api/v1/employees/{emp.emp_code}/photo?t={ts}",
    }
