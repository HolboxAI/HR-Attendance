"""Employee administration: hire, edit, offboard, re-issue a password.

Listing is manager-and-above and scoped through visible_employees, the same
one rule the board and the leave queue use - a manager sees their reports, HR
sees everyone. Everything that CHANGES a person is hr_admin and above, with
role changes narrowed again to super_admin inside the service.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.api.routes.admin import visible_employees
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import UserRole
from app.models.org import Department
from app.services import employees as employee_service

router = APIRouter(prefix="/admin/employees", tags=["employees"])

approver = Depends(require_role(UserRole.MANAGER))
hr_only = Depends(require_role(UserRole.HR_ADMIN))


class EmployeeOut(BaseModel):
    emp_code: str
    full_name: str
    email: str | None
    phone: str | None
    department: str | None
    designation: str | None
    manager_code: str | None
    date_of_joining: date | None
    date_of_exit: date | None
    is_active: bool
    role: str | None
    has_login: bool


class CreateRequest(BaseModel):
    emp_code: str = Field(min_length=1, max_length=32)
    full_name: str = Field(min_length=1, max_length=160)
    # Plain str, not EmailStr - the same call auth.py already made, and for
    # the same reason: a format check stricter than whatever HR typed would
    # reject a real person for no benefit, and this address only has to match
    # what they later sign in with.
    email: str = Field(min_length=3, max_length=200)
    phone: str | None = None
    department: str | None = None
    designation: str | None = None
    shift: str | None = None
    manager_code: str | None = None
    date_of_joining: date | None = None
    role: UserRole = UserRole.EMPLOYEE


class UpdateRequest(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    designation: str | None = None
    date_of_joining: date | None = None
    department: str | None = None
    manager_code: str | None = None
    role: UserRole | None = None


class CreatedResponse(BaseModel):
    employee: EmployeeOut
    temporary_password: str
    note: str


class DeactivateRequest(BaseModel):
    date_of_exit: date | None = None


def to_out(db: Session, emp: Employee) -> EmployeeOut:
    dept = db.get(Department, emp.department_id) if emp.department_id else None
    manager = db.get(Employee, emp.manager_id) if emp.manager_id else None
    user = db.scalar(select(User).where(User.employee_id == emp.id))
    return EmployeeOut(
        emp_code=emp.emp_code, full_name=emp.full_name, email=emp.email,
        phone=emp.phone, department=dept.name if dept else None,
        designation=emp.designation,
        manager_code=manager.emp_code if manager else None,
        date_of_joining=emp.date_of_joining, date_of_exit=emp.date_of_exit,
        is_active=emp.is_active,
        role=user.role.value if user else None, has_login=user is not None,
    )


def _find(db: Session, employee_code: str) -> Employee:
    emp = db.scalar(select(Employee).where(Employee.emp_code == employee_code.upper()))
    if emp is None:
        raise HTTPException(404, f"No employee with code {employee_code}")
    return emp


@router.get("", response_model=list[EmployeeOut])
def list_employees(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: User = approver,
):
    rows = visible_employees(db, user)
    if include_inactive:
        # visible_employees only returns active people, by design - the board
        # should never show a leaver. Offboarding needs to see them, so this
        # widens the same scope rule rather than bypassing it.
        scope_admin = user.role in (UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
        if scope_admin:
            rows = db.scalars(select(Employee).order_by(Employee.emp_code)).all()
    return [to_out(db, e) for e in rows]


@router.get("/{employee_code}", response_model=EmployeeOut)
def get_employee(
    employee_code: str, db: Session = Depends(get_db), user: User = approver,
):
    emp = _find(db, employee_code)
    if emp.is_active and emp.id not in {e.id for e in visible_employees(db, user)}:
        # 404 rather than 403: whether a code exists is itself information a
        # manager outside the reporting line has no business confirming.
        raise HTTPException(404, f"No employee with code {employee_code}")
    return to_out(db, emp)


@router.post("", response_model=CreatedResponse, status_code=201)
def create_employee(
    body: CreateRequest, db: Session = Depends(get_db), actor: User = hr_only,
):
    result = employee_service.create(
        db, org_id=actor.org_id, actor=actor,
        emp_code=body.emp_code, full_name=body.full_name, email=body.email,
        phone=body.phone, department=body.department, designation=body.designation,
        shift=body.shift, manager_code=body.manager_code,
        date_of_joining=body.date_of_joining, role=body.role,
    )
    if not result.ok or result.employee is None:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not create that employee")
    db.commit()
    return CreatedResponse(
        employee=to_out(db, result.employee),
        temporary_password=result.temporary_password or "",
        note=("Shown once and not recoverable. Hand it over in person; they "
              "replace it with POST /auth/set-password."),
    )


@router.patch("/{employee_code}", response_model=EmployeeOut)
def update_employee(
    employee_code: str, body: UpdateRequest,
    db: Session = Depends(get_db), actor: User = hr_only,
):
    emp = _find(db, employee_code)
    result = employee_service.update(
        db, actor=actor, employee=emp,
        changes=body.model_dump(exclude_unset=True,
                                exclude={"department", "manager_code", "role"}),
        department=body.department, manager_code=body.manager_code, role=body.role,
    )
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not update that employee")
    db.commit()
    return to_out(db, emp)


@router.post("/{employee_code}/deactivate", response_model=EmployeeOut)
def deactivate_employee(
    employee_code: str, body: DeactivateRequest,
    db: Session = Depends(get_db), actor: User = hr_only,
):
    """Offboard. Signs them out, unbinds their phone, retires the enrolment.

    Nothing is deleted: the attendance history stays, and the reference photo
    file is removed later by the retention job, not here.
    """
    emp = _find(db, employee_code)
    result = employee_service.deactivate(
        db, actor=actor, employee=emp, exit_date=body.date_of_exit
    )
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not deactivate")
    db.commit()
    return to_out(db, emp)


@router.post("/{employee_code}/reset-password", response_model=CreatedResponse)
def reset_password(
    employee_code: str, db: Session = Depends(get_db), actor: User = hr_only,
):
    emp = _find(db, employee_code)
    result = employee_service.reset_password(db, actor=actor, employee=emp)
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not reset that password")
    db.commit()
    return CreatedResponse(
        employee=to_out(db, emp),
        temporary_password=result.temporary_password or "",
        note="Shown once and not recoverable. Hand it over in person.",
    )
