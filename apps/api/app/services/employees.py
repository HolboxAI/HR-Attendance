"""Creating, changing and offboarding people.

Until now the only way to add an employee was to edit scripts/seed.py and run
it. That is fine for a seeded prototype and unworkable the first time HR hires
someone on a Tuesday, and the PRD's definition of done is explicit that HR
must manage employees "without direct database access".

Two things here are deliberate.

ONE ACCOUNT, TWO ROWS. An Employee is the person attendance hangs off; a User
is a login. They are separate because not every employee needs a login, and
because deactivating a login should not erase an attendance history. Creating
someone makes both, in one transaction, so there is no window where a person
exists with no way to sign in.

THE TEMPORARY PASSWORD IS RETURNED ONCE. There is no email infrastructure, so
the alternative to handing HR a password is having no onboarding path at all.
It is generated here, hashed immediately, returned in the create/invite
response, and never stored or logged in the clear - the same trade
scripts/seed_users.py already makes when it prints one to a terminal.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import org_today
from app.core.security import hash_password
from app.models.attendance import ShiftAssignment, ShiftTemplate
from app.models.employee import Employee, User
from app.models.enums import EmploymentType, UserRole
from app.models.org import Department, Location
from app.services import notifications as notification_service
from app.services.leave import audit

# Readable rather than maximally random: this gets typed once, on a phone,
# from a note handed over in person, and then replaced via /auth/set-password.
# Same list as scripts/seed_users.py, which is where this pattern started.
WORDS = (
    "anchor bridge cobalt dahlia ember fathom granite harbour indigo juniper "
    "kestrel lantern marigold nutmeg opal parsley quartz rhubarb saffron thistle"
).split()


def new_password() -> str:
    return "-".join(secrets.choice(WORDS) for _ in range(3)) + f"-{secrets.randbelow(90) + 10}"


@dataclass(frozen=True)
class EmployeeOutcome:
    ok: bool
    employee: Employee | None = None
    # Only ever populated on create and invite, and only for the caller to
    # relay in person. Never persisted.
    temporary_password: str | None = None
    reason: str | None = None


def _by_code(db: Session, org_id: uuid.UUID, code: str) -> Employee | None:
    return db.scalar(
        select(Employee).where(Employee.org_id == org_id, Employee.emp_code == code)
    )


def suggest_next_employee_code(db: Session, org_id: uuid.UUID) -> str:
    """Find the next sequential employee code matching prefix BX###."""
    import re
    codes = db.scalars(select(Employee.emp_code).where(Employee.org_id == org_id)).all()
    max_num = 0
    for c in codes:
        m = re.match(r"^BX(\d+)$", (c or "").strip().upper())
        if m:
            try:
                num = int(m.group(1))
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    next_num = max_num + 1
    return f"BX{next_num:03d}"


def create(
    db: Session,
    *,
    org_id: uuid.UUID,
    actor: User,
    emp_code: str,
    full_name: str,
    email: str,
    phone: str | None = None,
    department: str | None = None,
    designation: str | None = None,
    shift: str | None = None,
    manager_code: str | None = None,
    date_of_joining: date | None = None,
    role: UserRole = UserRole.EMPLOYEE,
    password_hash: str | None = None,
) -> EmployeeOutcome:
    """Create an employee, their login, and their shift assignment."""
    emp_code = emp_code.strip().upper()
    email = email.strip().lower()

    if not emp_code or not full_name.strip() or not email:
        return EmployeeOutcome(False, reason="Employee code, name and email are all required")

    if _by_code(db, org_id, emp_code) is not None:
        return EmployeeOutcome(False, reason=f"{emp_code} already exists")
    if db.scalar(select(User).where(User.email == email)) is not None:
        return EmployeeOutcome(False, reason=f"{email} is already in use")

    # Only admins may create accounts above employee.
    if role != UserRole.EMPLOYEE and actor.role not in (UserRole.HR_ADMIN, UserRole.SUPER_ADMIN):
        return EmployeeOutcome(
            False, reason="Only an admin can create an account above employee"
        )

    dept_row = None
    if department:
        dept_row = db.scalar(
            select(Department).where(
                Department.org_id == org_id, Department.name == department
            )
        )
        if dept_row is None:
            return EmployeeOutcome(False, reason=f"No department called '{department}'")

    manager = None
    if manager_code:
        manager = _by_code(db, org_id, manager_code.strip().upper())
        if manager is None:
            return EmployeeOutcome(False, reason=f"No employee with code {manager_code}")

    shift_row = None
    if shift:
        shift_row = db.scalar(
            select(ShiftTemplate).where(
                ShiftTemplate.org_id == org_id, ShiftTemplate.name == shift
            )
        )
        if shift_row is None:
            return EmployeeOutcome(False, reason=f"No shift called '{shift}'")

    location = db.scalar(select(Location).where(Location.org_id == org_id))
    joined = date_of_joining or org_today()

    employee = Employee(
        id=uuid.uuid4(), org_id=org_id, emp_code=emp_code,
        full_name=full_name.strip(), email=email, phone=phone,
        department_id=dept_row.id if dept_row else None,
        location_id=location.id if location else None,
        manager_id=manager.id if manager else None,
        designation=designation, employment_type=EmploymentType.FULL_TIME,
        date_of_joining=joined, is_active=True,
    )
    db.add(employee)
    db.flush()

    if shift_row is not None:
        db.add(ShiftAssignment(
            id=uuid.uuid4(), employee_id=employee.id,
            shift_template_id=shift_row.id, effective_from=joined,
        ))

    if password_hash:
        final_hash = password_hash
        temporary_pass = None
    else:
        password = new_password()
        final_hash = hash_password(password)
        temporary_pass = password

    user = User(
        id=uuid.uuid4(), org_id=org_id, employee_id=employee.id,
        email=email, password_hash=final_hash,
        role=role, is_active=True,
    )
    db.add(user)
    db.flush()

    # The PRD lists "employee invite" as a notification trigger. The row is
    # written now and read on their first sign-in - which is the whole point of
    # notifications being records rather than pushes.
    notification_service.notify(
        db, org_id=org_id, user=user, category="employee_invite",
        title="Welcome to Boxcode",
        body="Your account is ready. Change your password from the app once you sign in.",
        data={"employee_code": emp_code},
    )

    audit(
        db, org_id=org_id, actor=actor, entity="employee", entity_id=employee.id,
        action="created",
        changes={"emp_code": {"old": None, "new": emp_code},
                 "full_name": {"old": None, "new": employee.full_name},
                 "email": {"old": None, "new": email},
                 "role": {"old": None, "new": role.value}},
    )

    return EmployeeOutcome(True, employee=employee, temporary_password=temporary_pass)


# Fields a PATCH may touch. Deliberately excludes emp_code (it is the stable
# identifier every attendance row and export column hangs off) and is_active
# (that is offboarding, which has to do more than flip a flag).
EDITABLE = ("full_name", "email", "phone", "designation", "date_of_joining", "correction_limit")


def update(
    db: Session, *, actor: User, employee: Employee, changes: dict,
    department: str | None = None, manager_code: str | None = None,
    role: UserRole | None = None,
) -> EmployeeOutcome:
    recorded: dict = {}

    for field in EDITABLE:
        if field not in changes or changes[field] is None:
            continue
        new = changes[field]
        if field == "email":
            new = str(new).strip().lower()
            clash = db.scalar(select(User).where(User.email == new))
            if clash is not None and clash.employee_id != employee.id:
                return EmployeeOutcome(False, reason=f"{new} is already in use")
        old = getattr(employee, field)
        if old == new:
            continue
        setattr(employee, field, new)
        recorded[field] = {"old": str(old) if old is not None else None, "new": str(new)}

    if department is not None:
        dept_row = db.scalar(
            select(Department).where(
                Department.org_id == employee.org_id, Department.name == department
            )
        )
        if dept_row is None:
            return EmployeeOutcome(False, reason=f"No department called '{department}'")
        if employee.department_id != dept_row.id:
            recorded["department"] = {"old": str(employee.department_id), "new": department}
            employee.department_id = dept_row.id

    if manager_code is not None:
        manager = _by_code(db, employee.org_id, manager_code.strip().upper())
        if manager is None:
            return EmployeeOutcome(False, reason=f"No employee with code {manager_code}")
        if manager.id == employee.id:
            return EmployeeOutcome(False, reason="Someone cannot report to themselves")
        if employee.manager_id != manager.id:
            recorded["manager"] = {"old": str(employee.manager_id), "new": manager.emp_code}
            employee.manager_id = manager.id

    user = db.scalar(select(User).where(User.employee_id == employee.id))

    if role is not None and user is not None and user.role != role:
        if actor.role not in (UserRole.HR_ADMIN, UserRole.SUPER_ADMIN):
            return EmployeeOutcome(False, reason="Only an admin can change a role")
        if user.id == actor.id:
            # Nobody edits their own access. Same rule as leave approvals.
            return EmployeeOutcome(False, reason="You cannot change your own role")
        recorded["role"] = {"old": user.role.value, "new": role.value}
        user.role = role

    # The login follows the employee's address, or the two drift and the person
    # can no longer sign in with the address HR thinks they have.
    if "email" in recorded and user is not None:
        user.email = employee.email

    if recorded:
        audit(db, org_id=employee.org_id, actor=actor, entity="employee",
              entity_id=employee.id, action="updated", changes=recorded)

    return EmployeeOutcome(True, employee=employee)


def deactivate(
    db: Session, *, actor: User, employee: Employee, exit_date: date | None = None
) -> EmployeeOutcome:
    """Offboard. Nothing is deleted - attendance history has to survive."""
    if employee.id == actor.employee_id:
        return EmployeeOutcome(False, reason="You cannot deactivate your own record")
    if not employee.is_active:
        return EmployeeOutcome(False, reason=f"{employee.emp_code} is already inactive")

    employee.is_active = False
    employee.date_of_exit = exit_date or org_today()

    user = db.scalar(select(User).where(User.employee_id == employee.id))
    if user is not None:
        # deps.get_current_user re-reads this on every request, so the next
        # call with an existing token is refused rather than waiting for it
        # to expire.
        user.is_active = False

    # Free the handset so it can be issued to someone else, and stop the
    # enrolment being compared against. The photo file itself is removed later
    # by scripts/purge_photos.py, on the retention schedule.
    from app.services import devices as device_service
    from app.services.enrolment import retire

    device_service.clear(db, employee)
    retire(db, employee)

    audit(db, org_id=employee.org_id, actor=actor, entity="employee",
          entity_id=employee.id, action="deactivated",
          changes={"is_active": {"old": True, "new": False},
                   "date_of_exit": {"old": None, "new": str(employee.date_of_exit)}})

    return EmployeeOutcome(True, employee=employee)


def reset_password(db: Session, *, actor: User, employee: Employee) -> EmployeeOutcome:
    """Re-issue a temporary password. Used for onboarding and for lockouts."""
    user = db.scalar(select(User).where(User.employee_id == employee.id))
    if user is None:
        return EmployeeOutcome(False, reason=f"{employee.emp_code} has no login account")

    password = new_password()
    user.password_hash = hash_password(password)
    user.is_active = True

    audit(db, org_id=employee.org_id, actor=actor, entity="employee",
          entity_id=employee.id, action="password_reset",
          note="temporary password issued")

    return EmployeeOutcome(True, employee=employee, temporary_password=password)


def delete_permanently(
    db: Session, *, actor: User, employee: Employee
) -> EmployeeOutcome:
    """Permanently delete an employee and all associated data, history, and files."""
    if employee.id == actor.employee_id:
        return EmployeeOutcome(False, reason="You cannot delete your own employee record")

    from sqlalchemy import delete, update
    from app.services.storage import storage
    from app.models.attendance import (
        AttendanceDay, DeviceEnrollment, PunchEvent,
        ShiftAssignment, ShiftGroupMember,
    )
    from app.models.correction import CorrectionRequest
    from app.models.face import EnrolmentRequest, FaceEnrollment, MobileDevice
    from app.models.leave import (
        AccrualRun, AuditLog, CarryForwardRun, LeaveBalance, LeaveRequest,
    )
    from app.models.notification import Notification
    from app.models.wfh_request import WFHRequest
    from app.models.auth import RefreshSession
    from app.models.signup_request import SignupRequest

    emp_id = employee.id
    emp_code = employee.emp_code
    emp_name = employee.full_name
    org_id = employee.org_id

    # 1. Clean up stored files (punch selfies, reference photos, medical documents)
    try:
        punches = db.scalars(select(PunchEvent).where(PunchEvent.employee_id == emp_id)).all()
        for p in punches:
            if p.photo_key:
                try:
                    storage.delete(p.photo_key)
                except Exception:
                    pass

        faces = db.scalars(select(FaceEnrollment).where(FaceEnrollment.employee_id == emp_id)).all()
        for f in faces:
            if f.photo_key:
                try:
                    storage.delete(f.photo_key)
                except Exception:
                    pass

        enrol_reqs = db.scalars(select(EnrolmentRequest).where(EnrolmentRequest.employee_id == emp_id)).all()
        for er in enrol_reqs:
            if er.photo_key:
                try:
                    storage.delete(er.photo_key)
                except Exception:
                    pass

        leaves = db.scalars(select(LeaveRequest).where(LeaveRequest.employee_id == emp_id)).all()
        for l in leaves:
            if l.medical_document_url:
                try:
                    storage.delete(l.medical_document_url)
                except Exception:
                    pass
    except Exception:
        pass

    # 2. Unlink any other employees who have this person as their manager
    db.execute(
        update(Employee).where(Employee.manager_id == emp_id).values(manager_id=None)
    )

    # 3. If there is a linked User login account, unlink decider/approver references and remove sessions/notifications
    user = db.scalar(select(User).where(User.employee_id == emp_id))
    if user is not None:
        user_id = user.id
        db.execute(update(AuditLog).where(AuditLog.actor_user_id == user_id).values(actor_user_id=None))
        db.execute(update(CorrectionRequest).where(CorrectionRequest.decided_by == user_id).values(decided_by=None))
        db.execute(update(EnrolmentRequest).where(EnrolmentRequest.decided_by == user_id).values(decided_by=None))
        db.execute(update(FaceEnrollment).where(FaceEnrollment.enrolled_by == user_id).values(enrolled_by=None))
        db.execute(update(LeaveRequest).where(LeaveRequest.approver_id == user_id).values(approver_id=None))
        db.execute(update(WFHRequest).where(WFHRequest.decided_by_id == user_id).values(decided_by_id=None))
        db.execute(update(SignupRequest).where(SignupRequest.decided_by_id == user_id).values(decided_by_id=None))

        db.execute(delete(RefreshSession).where(RefreshSession.user_id == user_id))
        db.execute(delete(Notification).where(Notification.user_id == user_id))

        db.delete(user)
        db.flush()

    db.execute(delete(SignupRequest).where(SignupRequest.created_employee_id == emp_id))

    # 4. Cascade delete all employee operational tables
    db.execute(delete(CorrectionRequest).where(CorrectionRequest.employee_id == emp_id))
    db.execute(delete(WFHRequest).where(WFHRequest.employee_id == emp_id))
    db.execute(delete(LeaveRequest).where(LeaveRequest.employee_id == emp_id))
    db.execute(delete(LeaveBalance).where(LeaveBalance.employee_id == emp_id))
    db.execute(delete(AccrualRun).where(AccrualRun.employee_id == emp_id))
    db.execute(delete(CarryForwardRun).where(CarryForwardRun.employee_id == emp_id))
    db.execute(delete(AttendanceDay).where(AttendanceDay.employee_id == emp_id))
    db.execute(delete(PunchEvent).where(PunchEvent.employee_id == emp_id))
    db.execute(delete(DeviceEnrollment).where(DeviceEnrollment.employee_id == emp_id))
    db.execute(delete(MobileDevice).where(MobileDevice.employee_id == emp_id))
    db.execute(delete(FaceEnrollment).where(FaceEnrollment.employee_id == emp_id))
    db.execute(delete(EnrolmentRequest).where(EnrolmentRequest.employee_id == emp_id))
    db.execute(delete(ShiftAssignment).where(ShiftAssignment.employee_id == emp_id))
    db.execute(delete(ShiftGroupMember).where(ShiftGroupMember.employee_id == emp_id))

    # 5. Delete the Employee record itself
    db.delete(employee)

    # 6. Audit log entry
    audit(
        db,
        org_id=org_id,
        actor=actor,
        entity="employee",
        entity_id=emp_id,
        action="deleted",
        changes={"emp_code": emp_code, "full_name": emp_name},
        note=f"Permanently deleted employee {emp_code} and all related history and data",
    )

    db.commit()

    return EmployeeOutcome(True, employee=None)

