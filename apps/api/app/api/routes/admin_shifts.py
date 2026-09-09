"""Shift Management API — PRD Phase 5 (Features 22, 23, 24, 25).

Provides endpoints for:
- Shift Templates CRUD
- Organization-Wide Default Shift
- Employee-Specific Shift Assignments (Direct Overrides)
- Shift Groups with Multi-Employee Checkbox Assignment
- Employee Shift Roster with Deterministic Hierarchy Resolution
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.core.clock import org_today
from app.db.session import get_db
from app.models.attendance import (
    ShiftAssignment,
    ShiftGroup,
    ShiftGroupMember,
    ShiftTemplate,
)
from app.models.employee import Employee, User
from app.models.enums import UserRole
from app.models.org import Department, Organization
from app.services.attendance import resolve_shift
from app.services.notifications import notify

router = APIRouter(prefix="/admin/shifts", tags=["admin-shifts"])

hr_admin = Depends(require_role(UserRole.HR_ADMIN))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ShiftTemplateIn(BaseModel):
    name: str = Field(..., max_length=80)
    start_time: str = Field(..., description="HH:MM format, e.g. 09:30")
    end_time: str = Field(..., description="HH:MM format, e.g. 18:30")
    break_minutes: int = 60
    grace_minutes: int = 15
    half_day_after_minutes: int = 240
    full_day_after_minutes: int = 450
    cutover_hour: int = 5
    working_days: list[int] = Field(default=[0, 1, 2, 3, 4, 5], description="Mon=0 .. Sun=6")


class ShiftTemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    start_time: str
    end_time: str
    break_minutes: int
    grace_minutes: int
    half_day_after_minutes: int
    full_day_after_minutes: int
    cutover_hour: int
    working_days: list[int]
    is_default: bool = False
    active_assignments_count: int = 0


class ShiftsListResponse(BaseModel):
    shifts: list[ShiftTemplateOut]
    default_shift_template_id: Optional[uuid.UUID] = None


class SetDefaultShiftRequest(BaseModel):
    shift_template_id: uuid.UUID


class DirectAssignRequest(BaseModel):
    employee_id: uuid.UUID
    shift_template_id: uuid.UUID
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None


class ShiftGroupIn(BaseModel):
    name: str = Field(..., max_length=120)
    description: Optional[str] = Field(None, max_length=255)
    shift_template_id: uuid.UUID
    employee_ids: list[uuid.UUID] = Field(default_factory=list)


class ShiftGroupMemberOut(BaseModel):
    employee_id: uuid.UUID
    emp_code: str
    full_name: str
    department: Optional[str] = None


class ShiftGroupOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    shift_template_id: uuid.UUID
    shift_template_name: str
    shift_template_start: str
    shift_template_end: str
    members: list[ShiftGroupMemberOut]
    member_count: int


class RosterItemOut(BaseModel):
    employee_id: uuid.UUID
    emp_code: str
    full_name: str
    department: Optional[str] = None
    designation: Optional[str] = None
    effective_shift_id: Optional[uuid.UUID] = None
    effective_shift_name: str
    effective_shift_start: str
    effective_shift_end: str
    source: str  # "direct", "group", "default", "fallback"
    group_name: Optional[str] = None
    direct_assignment_id: Optional[uuid.UUID] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_time(t_str: str) -> time:
    """Parses HH:MM or HH:MM:SS string into a datetime.time object."""
    parts = [int(p) for p in t_str.strip().split(":")]
    if len(parts) == 2:
        return time(parts[0], parts[1], 0)
    elif len(parts) == 3:
        return time(parts[0], parts[1], parts[2])
    raise ValueError(f"Invalid time format: {t_str}. Expected HH:MM")


def _format_time(t: time) -> str:
    return t.strftime("%H:%M")


def _notify_employee(
    db: Session,
    org_id: uuid.UUID,
    employee_id: uuid.UUID,
    category: str,
    title: str,
    body: str,
    data: dict | None = None,
):
    user = db.scalar(select(User).where(User.employee_id == employee_id))
    if user:
        notify(
            db,
            org_id=org_id,
            user=user,
            category=category,
            title=title,
            body=body,
            data=data or {},
        )


# ---------------------------------------------------------------------------
# Shift Templates (Feature 22 & Feature 23)
# ---------------------------------------------------------------------------

@router.get("", response_model=ShiftsListResponse)
def list_shifts(
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """List all shift templates in the organization along with the org-wide default."""
    org = db.get(Organization, current_user.org_id)
    default_id_str = org.settings.get("default_shift_template_id") if org and org.settings else None
    default_id = None
    if default_id_str:
        try:
            default_id = uuid.UUID(str(default_id_str))
        except (ValueError, TypeError):
            pass

    templates = db.scalars(
        select(ShiftTemplate)
        .where(ShiftTemplate.org_id == current_user.org_id)
        .order_by(ShiftTemplate.name.asc())
    ).all()

    today = org_today()
    out = []
    for t in templates:
        # Count direct assignments currently effective
        direct_count = db.scalar(
            select(ShiftAssignment.id)
            .where(
                and_(
                    ShiftAssignment.shift_template_id == t.id,
                    ShiftAssignment.effective_from <= today,
                    (ShiftAssignment.effective_to.is_(None) | (ShiftAssignment.effective_to >= today)),
                )
            )
        )
        is_def = (default_id == t.id)
        out.append(ShiftTemplateOut(
            id=t.id,
            name=t.name,
            start_time=_format_time(t.start_time),
            end_time=_format_time(t.end_time),
            break_minutes=t.break_minutes,
            grace_minutes=t.grace_minutes,
            half_day_after_minutes=t.half_day_after_minutes,
            full_day_after_minutes=t.full_day_after_minutes,
            cutover_hour=t.cutover_hour,
            working_days=list(t.working_days or [0, 1, 2, 3, 4, 5]),
            is_default=is_def,
            active_assignments_count=1 if direct_count else 0,
        ))

    return ShiftsListResponse(
        shifts=out,
        default_shift_template_id=default_id,
    )


@router.post("", response_model=ShiftTemplateOut)
def create_shift(
    body: ShiftTemplateIn,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Create a new shift template."""
    try:
        s_time = _parse_time(body.start_time)
        e_time = _parse_time(body.end_time)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Check for duplicate name in org
    existing = db.scalar(
        select(ShiftTemplate).where(
            and_(
                ShiftTemplate.org_id == current_user.org_id,
                ShiftTemplate.name == body.name.strip(),
            )
        )
    )
    if existing:
        raise HTTPException(409, f"A shift template named '{body.name}' already exists.")

    template = ShiftTemplate(
        org_id=current_user.org_id,
        name=body.name.strip(),
        start_time=s_time,
        end_time=e_time,
        break_minutes=body.break_minutes,
        grace_minutes=body.grace_minutes,
        half_day_after_minutes=body.half_day_after_minutes,
        full_day_after_minutes=body.full_day_after_minutes,
        cutover_hour=body.cutover_hour,
        working_days=body.working_days,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    # If organization has no default shift yet, automatically make this one default
    org = db.get(Organization, current_user.org_id)
    is_def = False
    if org and not org.settings.get("default_shift_template_id"):
        org.settings = {**org.settings, "default_shift_template_id": str(template.id)}
        db.commit()
        is_def = True

    return ShiftTemplateOut(
        id=template.id,
        name=template.name,
        start_time=_format_time(template.start_time),
        end_time=_format_time(template.end_time),
        break_minutes=template.break_minutes,
        grace_minutes=template.grace_minutes,
        half_day_after_minutes=template.half_day_after_minutes,
        full_day_after_minutes=template.full_day_after_minutes,
        cutover_hour=template.cutover_hour,
        working_days=list(template.working_days or [0, 1, 2, 3, 4, 5]),
        is_default=is_def,
        active_assignments_count=0,
    )


@router.put("/default", response_model=dict)
def set_default_shift(
    body: SetDefaultShiftRequest,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Set the organization-wide default shift template (Feature 23)."""
    template = db.get(ShiftTemplate, body.shift_template_id)
    if not template or template.org_id != current_user.org_id:
        raise HTTPException(404, "Shift template not found in organization.")

    org = db.get(Organization, current_user.org_id)
    if not org:
        raise HTTPException(404, "Organization not found.")

    org.settings = {**org.settings, "default_shift_template_id": str(body.shift_template_id)}
    db.commit()

    return {
        "message": f"'{template.name}' is now the organization default shift.",
        "default_shift_template_id": str(body.shift_template_id),
    }


@router.put("/{shift_id}", response_model=ShiftTemplateOut)
def update_shift(
    shift_id: uuid.UUID,
    body: ShiftTemplateIn,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Update an existing shift template."""
    template = db.get(ShiftTemplate, shift_id)
    if not template or template.org_id != current_user.org_id:
        raise HTTPException(404, "Shift template not found.")

    try:
        s_time = _parse_time(body.start_time)
        e_time = _parse_time(body.end_time)
    except ValueError as e:
        raise HTTPException(400, str(e))

    template.name = body.name.strip()
    template.start_time = s_time
    template.end_time = e_time
    template.break_minutes = body.break_minutes
    template.grace_minutes = body.grace_minutes
    template.half_day_after_minutes = body.half_day_after_minutes
    template.full_day_after_minutes = body.full_day_after_minutes
    template.cutover_hour = body.cutover_hour
    template.working_days = body.working_days

    db.commit()
    db.refresh(template)

    org = db.get(Organization, current_user.org_id)
    is_def = bool(org and org.settings.get("default_shift_template_id") == str(template.id))

    return ShiftTemplateOut(
        id=template.id,
        name=template.name,
        start_time=_format_time(template.start_time),
        end_time=_format_time(template.end_time),
        break_minutes=template.break_minutes,
        grace_minutes=template.grace_minutes,
        half_day_after_minutes=template.half_day_after_minutes,
        full_day_after_minutes=template.full_day_after_minutes,
        cutover_hour=template.cutover_hour,
        working_days=list(template.working_days or [0, 1, 2, 3, 4, 5]),
        is_default=is_def,
        active_assignments_count=0,
    )


@router.delete("/{shift_id}")
def delete_shift(
    shift_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Delete a shift template if not org default and not currently assigned."""
    template = db.get(ShiftTemplate, shift_id)
    if not template or template.org_id != current_user.org_id:
        raise HTTPException(404, "Shift template not found.")

    org = db.get(Organization, current_user.org_id)
    if org and org.settings.get("default_shift_template_id") == str(shift_id):
        raise HTTPException(400, "Cannot delete organization default shift. Please set another shift as default first.")

    # Check shift groups
    groups_count = db.scalar(
        select(ShiftGroup.id).where(
            and_(
                ShiftGroup.shift_template_id == shift_id,
                ShiftGroup.deleted_at.is_(None),
            )
        )
    )
    if groups_count:
        raise HTTPException(409, "Cannot delete shift template because it is assigned to one or more shift groups.")

    # Check direct assignments
    assignments_count = db.scalar(
        select(ShiftAssignment.id).where(ShiftAssignment.shift_template_id == shift_id)
    )
    if assignments_count:
        raise HTTPException(409, "Cannot delete shift template because it has employee assignments.")

    db.delete(template)
    db.commit()
    return {"message": "Shift template deleted successfully."}


# ---------------------------------------------------------------------------
# Employee Shift Roster & Direct Assignments (Feature 24)
# ---------------------------------------------------------------------------

@router.get("/roster", response_model=list[RosterItemOut])
def get_roster(
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """List all employees with their resolved effective shift following PRD §8.5 hierarchy."""
    employees = db.scalars(
        select(Employee)
        .where(Employee.org_id == current_user.org_id, Employee.is_active.is_(True))
        .order_by(Employee.full_name.asc())
    ).all()

    departments = {
        d.id: d.name
        for d in db.scalars(select(Department).where(Department.org_id == current_user.org_id)).all()
    }

    today = org_today()
    roster: list[RosterItemOut] = []

    for emp in employees:
        tpl, source, group_name, assignment_id = resolve_shift(db, emp, today)
        dept_name = departments.get(emp.department_id) if emp.department_id else None

        if tpl:
            s_name = tpl.name
            s_start = _format_time(tpl.start_time)
            s_end = _format_time(tpl.end_time)
            tpl_id = tpl.id
        else:
            s_name = "Standard (09:00 - 18:00)"
            s_start = "09:00"
            s_end = "18:00"
            tpl_id = None

        roster.append(RosterItemOut(
            employee_id=emp.id,
            emp_code=emp.emp_code,
            full_name=emp.full_name,
            department=dept_name,
            designation=emp.designation,
            effective_shift_id=tpl_id,
            effective_shift_name=s_name,
            effective_shift_start=s_start,
            effective_shift_end=s_end,
            source=source,
            group_name=group_name,
            direct_assignment_id=assignment_id,
        ))

    return roster


@router.post("/assign", response_model=dict)
def assign_direct_shift(
    body: DirectAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Directly assign a shift to an employee, overriding group and org default (Feature 24)."""
    emp = db.get(Employee, body.employee_id)
    if not emp or emp.org_id != current_user.org_id:
        raise HTTPException(404, "Employee not found.")

    template = db.get(ShiftTemplate, body.shift_template_id)
    if not template or template.org_id != current_user.org_id:
        raise HTTPException(404, "Shift template not found.")

    eff_from = body.effective_from or org_today()

    # Clear existing active assignments starting on or after eff_from
    db.execute(
        delete(ShiftAssignment).where(
            and_(
                ShiftAssignment.employee_id == emp.id,
                ShiftAssignment.effective_from >= eff_from,
            )
        )
    )

    assignment = ShiftAssignment(
        employee_id=emp.id,
        shift_template_id=template.id,
        effective_from=eff_from,
        effective_to=body.effective_to,
    )
    db.add(assignment)

    _notify_employee(
        db=db,
        org_id=current_user.org_id,
        employee_id=emp.id,
        category="shift.direct_assigned",
        title="Direct Shift Assigned",
        body=f"You have been assigned custom shift {template.name} ({_format_time(template.start_time)} - {_format_time(template.end_time)}) effective from {eff_from}.",
        data={"shift_template_id": str(template.id), "effective_from": str(eff_from)},
    )

    db.commit()

    return {
        "message": f"Assigned '{template.name}' directly to {emp.full_name}.",
        "assignment_id": str(assignment.id),
    }


@router.delete("/assign/{employee_id}", response_model=dict)
def clear_direct_shift(
    employee_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Clear direct shift override, causing employee to revert to Group or Org Default (Feature 24)."""
    emp = db.get(Employee, employee_id)
    if not emp or emp.org_id != current_user.org_id:
        raise HTTPException(404, "Employee not found.")

    db.execute(
        delete(ShiftAssignment).where(ShiftAssignment.employee_id == emp.id)
    )

    _notify_employee(
        db=db,
        org_id=current_user.org_id,
        employee_id=emp.id,
        category="shift.override_cleared",
        title="Shift Override Cleared",
        body="Your individual shift override has been cleared. Your work schedule has reverted to your group or organization default.",
        data={"employee_id": str(emp.id)},
    )

    db.commit()

    return {"message": f"Direct shift override cleared for {emp.full_name}. Now inherits group or organization default."}


# ---------------------------------------------------------------------------
# Shift Groups (Feature 25)
# ---------------------------------------------------------------------------

@router.get("/groups", response_model=list[ShiftGroupOut])
def list_shift_groups(
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """List all shift groups with assigned templates and member employees."""
    groups = db.scalars(
        select(ShiftGroup)
        .where(
            and_(
                ShiftGroup.org_id == current_user.org_id,
                ShiftGroup.deleted_at.is_(None),
            )
        )
        .order_by(ShiftGroup.name.asc())
    ).all()

    departments = {
        d.id: d.name
        for d in db.scalars(select(Department).where(Department.org_id == current_user.org_id)).all()
    }

    out: list[ShiftGroupOut] = []
    for g in groups:
        template = db.get(ShiftTemplate, g.shift_template_id)
        # Fetch members
        members_stmt = (
            select(Employee)
            .join(ShiftGroupMember, ShiftGroupMember.employee_id == Employee.id)
            .where(
                and_(
                    ShiftGroupMember.shift_group_id == g.id,
                    Employee.deleted_at.is_(None),
                )
            )
            .order_by(Employee.full_name.asc())
        )
        members_list = db.scalars(members_stmt).all()

        members_out = [
            ShiftGroupMemberOut(
                employee_id=m.id,
                emp_code=m.emp_code,
                full_name=m.full_name,
                department=departments.get(m.department_id) if m.department_id else None,
            )
            for m in members_list
        ]

        out.append(ShiftGroupOut(
            id=g.id,
            name=g.name,
            description=g.description,
            shift_template_id=g.shift_template_id,
            shift_template_name=template.name if template else "Unknown",
            shift_template_start=_format_time(template.start_time) if template else "00:00",
            shift_template_end=_format_time(template.end_time) if template else "00:00",
            members=members_out,
            member_count=len(members_out),
        ))

    return out


@router.post("/groups", response_model=ShiftGroupOut)
def create_shift_group(
    body: ShiftGroupIn,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Create a new shift group, assign a shift template, and add member employees."""
    template = db.get(ShiftTemplate, body.shift_template_id)
    if not template or template.org_id != current_user.org_id:
        raise HTTPException(404, "Shift template not found.")

    group = ShiftGroup(
        org_id=current_user.org_id,
        name=body.name.strip(),
        description=body.description.strip() if body.description else None,
        shift_template_id=template.id,
    )
    db.add(group)
    db.flush()

    for emp_id in set(body.employee_ids):
        emp = db.get(Employee, emp_id)
        if emp and emp.org_id == current_user.org_id:
            # Delete any existing membership for this group (safety)
            db.add(ShiftGroupMember(shift_group_id=group.id, employee_id=emp.id))
            _notify_employee(
                db=db,
                org_id=current_user.org_id,
                employee_id=emp.id,
                category="shift.group_assigned",
                title="Shift Schedule Assigned",
                body=f"You have been assigned to shift group '{group.name}' with schedule {template.name} ({_format_time(template.start_time)} - {_format_time(template.end_time)}).",
                data={"group_id": str(group.id), "shift_template_id": str(template.id)},
            )

    db.commit()
    db.refresh(group)

    return list_shift_groups(db=db, current_user=current_user)[-1]


@router.put("/groups/{group_id}", response_model=dict)
def update_shift_group(
    group_id: uuid.UUID,
    body: ShiftGroupIn,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Update shift group name, description, shift template, and sync member employee IDs."""
    group = db.get(ShiftGroup, group_id)
    if not group or group.org_id != current_user.org_id or group.deleted_at is not None:
        raise HTTPException(404, "Shift group not found.")

    template = db.get(ShiftTemplate, body.shift_template_id)
    if not template or template.org_id != current_user.org_id:
        raise HTTPException(404, "Shift template not found.")

    group.name = body.name.strip()
    group.description = body.description.strip() if body.description else None
    group.shift_template_id = template.id

    existing_members = set(db.scalars(
        select(ShiftGroupMember.employee_id).where(ShiftGroupMember.shift_group_id == group.id)
    ).all())
    new_members = set(body.employee_ids)

    # Sync members: clear existing and re-add selected
    db.execute(
        delete(ShiftGroupMember).where(ShiftGroupMember.shift_group_id == group.id)
    )
    for emp_id in new_members:
        emp = db.get(Employee, emp_id)
        if emp and emp.org_id == current_user.org_id:
            db.add(ShiftGroupMember(shift_group_id=group.id, employee_id=emp.id))
            _notify_employee(
                db=db,
                org_id=current_user.org_id,
                employee_id=emp.id,
                category="shift.group_assigned",
                title="Shift Schedule Assigned",
                body=f"Your shift group '{group.name}' schedule is {template.name} ({_format_time(template.start_time)} - {_format_time(template.end_time)}).",
                data={"group_id": str(group.id), "shift_template_id": str(template.id)},
            )

    removed_members = existing_members - new_members
    for emp_id in removed_members:
        _notify_employee(
            db=db,
            org_id=current_user.org_id,
            employee_id=emp_id,
            category="shift.group_removed",
            title="Shift Schedule Updated",
            body=f"You have been removed from shift group '{group.name}'. Your work schedule has reverted to the organization default.",
            data={"group_id": str(group.id)},
        )

    db.commit()
    return {"message": f"Shift group '{group.name}' updated successfully."}


@router.delete("/groups/{group_id}", response_model=dict)
def delete_shift_group(
    group_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = hr_admin,
):
    """Delete a shift group and remove all member associations."""
    group = db.get(ShiftGroup, group_id)
    if not group or group.org_id != current_user.org_id or group.deleted_at is not None:
        raise HTTPException(404, "Shift group not found.")

    member_emp_ids = db.scalars(
        select(ShiftGroupMember.employee_id).where(ShiftGroupMember.shift_group_id == group.id)
    ).all()

    db.execute(
        delete(ShiftGroupMember).where(ShiftGroupMember.shift_group_id == group.id)
    )
    group.deleted_at = datetime.now(timezone.utc)

    org = db.get(Organization, current_user.org_id)
    default_id_str = org.settings.get("default_shift_template_id") if org and org.settings else None
    default_template = None
    if default_id_str:
        try:
            default_template = db.get(ShiftTemplate, uuid.UUID(default_id_str))
        except (ValueError, TypeError):
            pass
    def_schedule_str = f"the organization default ({default_template.name} {_format_time(default_template.start_time)} - {_format_time(default_template.end_time)})" if default_template else "the organization default shift"

    for emp_id in member_emp_ids:
        _notify_employee(
            db=db,
            org_id=current_user.org_id,
            employee_id=emp_id,
            category="shift.group_deleted",
            title="Shift Schedule Updated",
            body=f"Shift group '{group.name}' was removed. Your work schedule has reverted to {def_schedule_str}.",
            data={"group_name": group.name},
        )

    db.commit()

    return {"message": f"Shift group '{group.name}' deleted successfully."}
