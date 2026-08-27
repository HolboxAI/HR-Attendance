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

    # Only super_admin may mint another admin. An hr_admin promoting someone to
    # super_admin would be a privilege escalation dressed up as onboarding.
    if role != UserRole.EMPLOYEE and actor.role != UserRole.SUPER_ADMIN:
        return EmployeeOutcome(
            False, reason="Only a super admin can create an account above employee"
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
    joined = date_of_joining or date.today()

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

    password = new_password()
    user = User(
        id=uuid.uuid4(), org_id=org_id, employee_id=employee.id,
        email=email, password_hash=hash_password(password),
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

    return EmployeeOutcome(True, employee=employee, temporary_password=password)


# Fields a PATCH may touch. Deliberately excludes emp_code (it is the stable
# identifier every attendance row and export column hangs off) and is_active
# (that is offboarding, which has to do more than flip a flag).
EDITABLE = ("full_name", "email", "phone", "designation", "date_of_joining")


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
        if actor.role != UserRole.SUPER_ADMIN:
            return EmployeeOutcome(False, reason="Only a super admin can change a role")
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
    employee.date_of_exit = exit_date or date.today()

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
