"""Face enrolment screens for HR.

Kept out of admin.py because that file is the attendance board and this is a
different job: admin.py answers "who was in today", this answers "who can the
face check actually verify".
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.models.employee import User
from app.core.config import settings
from app.db.session import get_db
from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.org import Department
from app.services.enrolment import (
    active_enrolment, enrol, history, retire, storage,
)

# Reference photos are biometric data about identifiable people. HR and above,
# with no per-route exceptions.
router = APIRouter(
    prefix="/admin/enrolments",
    tags=["enrolment"],
    dependencies=[Depends(require_role(UserRole.HR_ADMIN))],
)


class EnrolmentRow(BaseModel):
    employee_code: str
    full_name: str
    department: str | None
    enrolled: bool
    enrolled_at: datetime | None
    photo_count: int


class EnrolmentSummary(BaseModel):
    headcount: int
    enrolled: int
    missing: int
    # Surfaced so the screen can explain what the gap currently costs. When
    # this is False, an unenrolled employee still punches - the check is
    # recorded as "not verified" rather than blocking them.
    enrolment_required: bool
    face_provider: str


class EnrolmentListResponse(BaseModel):
    summary: EnrolmentSummary
    rows: list[EnrolmentRow]


class EnrolResponse(BaseModel):
    accepted: bool
    employee_code: str
    message: str
    photo_count: int


def _employee(db: Session, code: str) -> Employee:
    emp = db.scalar(select(Employee).where(Employee.emp_code == code))
    if emp is None:
        raise HTTPException(404, f"No employee with code {code}")
    return emp


@router.get("", response_model=EnrolmentListResponse)
def list_enrolments(db: Session = Depends(get_db)) -> EnrolmentListResponse:
    employees = db.scalars(
        select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.emp_code)
    ).all()

    rows: list[EnrolmentRow] = []
    for emp in employees:
        current = active_enrolment(db, emp)
        dept = db.get(Department, emp.department_id) if emp.department_id else None
        rows.append(EnrolmentRow(
            employee_code=emp.emp_code,
            full_name=emp.full_name,
            department=dept.name if dept else None,
            enrolled=current is not None,
            enrolled_at=current.enrolled_at if current else None,
            photo_count=len(history(db, emp)),
        ))

    enrolled = sum(1 for r in rows if r.enrolled)
    return EnrolmentListResponse(
        summary=EnrolmentSummary(
            headcount=len(rows),
            enrolled=enrolled,
            missing=len(rows) - enrolled,
            enrolment_required=settings.require_face_enrolment,
            face_provider=settings.face_provider,
        ),
        rows=rows,
    )


@router.post("", response_model=EnrolResponse)
async def create_enrolment(
    db: Session = Depends(get_db),
    photo: UploadFile = File(...),
    employee_code: str = Form(...),
    actor: User = Depends(require_role(UserRole.HR_ADMIN)),
) -> EnrolResponse:
    emp = _employee(db, employee_code)
    image = await photo.read()

    # enrolled_by comes from the token. The model has always had the column;
    # until auth existed there was nothing truthful to put in it.
    record, result = enrol(db, employee=emp, image=image, actor_id=actor.id)
    if record is None:
        # A rejected photo is not an error condition worth a 500 - it is a
        # normal outcome HR needs to read and act on, so it comes back 400
        # with the reason the face provider actually gave.
        db.rollback()
        raise HTTPException(400, result.reason or "Photo rejected")

    db.commit()
    return EnrolResponse(
        accepted=True,
        employee_code=emp.emp_code,
        message=result.reason or "Enrolled",
        photo_count=len(history(db, emp)),
    )


@router.get("/{employee_code}/photo")
def get_photo(employee_code: str, db: Session = Depends(get_db)) -> Response:
    """The reference photo currently in force, for HR to eyeball.

    Biometric data, so it is served inline and marked no-store rather than
    being left in a browser or proxy cache.
    """
    emp = _employee(db, employee_code)
    current = active_enrolment(db, emp)
    if current is None:
        raise HTTPException(404, f"{employee_code} has no reference photo")
    try:
        data = storage.get(current.photo_key)
    except FileNotFoundError:
        raise HTTPException(404, "The reference photo file is missing from storage")

    media = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
    return Response(content=data, media_type=media,
                    headers={"Cache-Control": "no-store"})


@router.delete("/{employee_code}", response_model=EnrolResponse)
def delete_enrolment(employee_code: str, db: Session = Depends(get_db)) -> EnrolResponse:
    emp = _employee(db, employee_code)
    if not retire(db, emp):
        raise HTTPException(404, f"{employee_code} has no reference photo to remove")
    db.commit()
    return EnrolResponse(
        accepted=True,
        employee_code=emp.emp_code,
        message="Reference photo withdrawn - this employee is no longer enrolled",
        photo_count=len(history(db, emp)),
    )
