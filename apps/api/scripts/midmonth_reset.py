"""Mid-month roster reset: keep five people, wipe their history, delete the rest.

    .venv/bin/python scripts/midmonth_reset.py
    .venv/bin/python scripts/midmonth_reset.py --apply --keep BX001,BX002,BX005,BX006,BX008

Default is dry-run. --apply refuses unless --keep matches the frozen keep-list
exactly, so a typo cannot empty the company.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.clock import org_today  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.attendance import (  # noqa: E402
    AttendanceDay,
    DeviceEnrollment,
    PunchEvent,
    ShiftAssignment,
    ShiftGroupMember,
    ShiftTemplate,
)
from app.models.auth import RefreshSession  # noqa: E402
from app.models.correction import CorrectionRequest  # noqa: E402
from app.models.employee import Employee, User  # noqa: E402
from app.models.face import EnrolmentRequest, FaceEnrollment, MobileDevice  # noqa: E402
from app.models.leave import AccrualRun, CarryForwardRun, LeaveBalance, LeaveRequest, LeaveType  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.wfh_request import WFHRequest  # noqa: E402
from app.services import employees as employee_service  # noqa: E402
from app.services import leave as leave_service  # noqa: E402
from app.services.storage import storage  # noqa: E402

KEEP_CODES = frozenset({"BX001", "BX002", "BX005", "BX006", "BX008"})
KEEP_LABEL = {
    "BX001": "Krish Sharma (admin)",
    "BX002": "Nikunj (employee)",
    "BX005": "Dhruv (admin)",
    "BX006": "Ashley (admin)",
    "BX008": "Himesh (admin)",
}


def _count(db: Session, model, emp_id: uuid.UUID) -> int:
    return int(
        db.scalar(select(func.count()).select_from(model).where(model.employee_id == emp_id)) or 0
    )


def _photo_keys(db: Session, emp_id: uuid.UUID) -> list[str]:
    keys: list[str] = []
    for p in db.scalars(select(PunchEvent).where(PunchEvent.employee_id == emp_id)).all():
        if p.photo_key:
            keys.append(p.photo_key)
    for f in db.scalars(select(FaceEnrollment).where(FaceEnrollment.employee_id == emp_id)).all():
        if f.photo_key:
            keys.append(f.photo_key)
    for er in db.scalars(select(EnrolmentRequest).where(EnrolmentRequest.employee_id == emp_id)).all():
        if er.photo_key:
            keys.append(er.photo_key)
    for req in db.scalars(select(LeaveRequest).where(LeaveRequest.employee_id == emp_id)).all():
        if req.medical_document_url:
            keys.append(req.medical_document_url)
    return keys


def _snapshot(db: Session, emp: Employee) -> dict:
    user = db.scalar(select(User).where(User.employee_id == emp.id))
    sessions = 0
    notes = 0
    if user is not None:
        sessions = int(
            db.scalar(select(func.count()).select_from(RefreshSession).where(RefreshSession.user_id == user.id)) or 0
        )
        notes = int(
            db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id)) or 0
        )
    return {
        "code": emp.emp_code,
        "name": emp.full_name,
        "email": emp.email,
        "active": emp.is_active,
        "role": user.role.value if user else "-",
        "punches": _count(db, PunchEvent, emp.id),
        "days": _count(db, AttendanceDay, emp.id),
        "faces": _count(db, FaceEnrollment, emp.id),
        "enrol_reqs": _count(db, EnrolmentRequest, emp.id),
        "devices": _count(db, MobileDevice, emp.id),
        "leave_reqs": _count(db, LeaveRequest, emp.id),
        "balances": _count(db, LeaveBalance, emp.id),
        "corrections": _count(db, CorrectionRequest, emp.id),
        "wfh": _count(db, WFHRequest, emp.id),
        "photos": len(_photo_keys(db, emp.id)),
        "sessions": sessions,
        "notifications": notes,
    }


def _print_row(kind: str, snap: dict) -> None:
    print(
        f"  {kind:6} {snap['code']:8} {snap['name']:<22} "
        f"role={snap['role']:<12} punches={snap['punches']} days={snap['days']} "
        f"faces={snap['faces']} devices={snap['devices']} photos={snap['photos']}"
    )


def wipe_keeper_history(db: Session, emp: Employee) -> None:
    """Same operational cleanup as delete_permanently, but the person stays."""
    emp_id = emp.id
    for key in _photo_keys(db, emp_id):
        try:
            storage.delete(key)
        except Exception:
            pass

    user = db.scalar(select(User).where(User.employee_id == emp_id))
    if user is not None:
        db.execute(delete(RefreshSession).where(RefreshSession.user_id == user.id))
        db.execute(delete(Notification).where(Notification.user_id == user.id))

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
    db.flush()


def restore_keeper_defaults(db: Session, emp: Employee) -> None:
    general = db.scalar(
        select(ShiftTemplate).where(
            ShiftTemplate.org_id == emp.org_id, ShiftTemplate.name == "General"
        )
    )
    if general is not None:
        db.add(
            ShiftAssignment(
                id=uuid.uuid4(),
                employee_id=emp.id,
                shift_template_id=general.id,
                effective_from=date(2026, 1, 1),
            )
        )

    types = db.scalars(
        select(LeaveType).where(
            LeaveType.org_id == emp.org_id,
            LeaveType.is_active.is_(True),
            LeaveType.deleted_at.is_(None),
        )
    ).all()
    pol = leave_service.policy(db, emp.org_id)
    period = leave_service.period_for(pol, org_today())
    for lt in types:
        leave_service.balance(db, emp, lt, period)
    db.flush()


def accrue_year_to_date(db: Session, org_id) -> None:
    """Credit Jan..current month once, after every keeper's accrual ledger is empty."""
    pol = leave_service.policy(db, org_id)
    today = org_today()
    year = today.year if pol.year_start_month == 1 else (
        today.year if today.month >= pol.year_start_month else today.year - 1
    )
    month = pol.year_start_month
    while True:
        leave_service.accrue_month(db, org_id=org_id, year=year, month=month)
        if year == today.year and month == today.month:
            break
        month += 1
        if month > 12:
            month = 1
            year += 1
        if year > today.year or (year == today.year and month > today.month):
            break


def parse_keep(raw: str | None) -> frozenset[str]:
    if not raw:
        return frozenset()
    return frozenset(code.strip().upper() for code in raw.split(",") if code.strip())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually write. Default is dry-run.")
    parser.add_argument(
        "--keep",
        help="Comma-separated emp codes. Required for --apply and must match the frozen keep-list.",
    )
    args = parser.parse_args()
    apply = args.apply
    keep_arg = parse_keep(args.keep)

    if apply:
        if keep_arg != KEEP_CODES:
            print(
                "Refusing --apply: --keep must be exactly "
                "BX001,BX002,BX005,BX006,BX008"
            )
            return 1

    db = SessionLocal()
    try:
        people = db.scalars(select(Employee).order_by(Employee.emp_code)).all()
        if not people:
            print("No employees in this database.")
            return 1

        keepers = [e for e in people if e.emp_code.upper() in KEEP_CODES]
        extras = [e for e in people if e.emp_code.upper() not in KEEP_CODES]
        missing = sorted(KEEP_CODES - {e.emp_code.upper() for e in keepers})

        actor = db.scalar(
            select(User).join(Employee, User.employee_id == Employee.id).where(
                Employee.emp_code == "BX001"
            )
        )
        if actor is None:
            print("Cannot find Krish (BX001) as actor. Aborting.")
            return 1

        print()
        print("KEEP (wipe history, keep login)")
        for emp in keepers:
            _print_row("KEEP", _snapshot(db, emp))
        if missing:
            print(f"  MISSING keepers: {', '.join(missing)}")

        print()
        print("DELETE (person + login + files + every related row)")
        if not extras:
            print("  (nobody)")
        for emp in extras:
            _print_row("DELETE", _snapshot(db, emp))

        print()
        print(f"keepers {len(keepers)}  delete {len(extras)}  missing {len(missing)}")
        if missing:
            print("A named keeper is not in this database. Aborting.")
            return 1

        if not apply:
            print()
            print("Dry-run only. Nothing was written.")
            print("Apply with:")
            print("  .venv/bin/python scripts/midmonth_reset.py --apply --keep BX001,BX002,BX005,BX006,BX008")
            print()
            return 0

        print()
        print("Applying…")
        for emp in extras:
            code, name = emp.emp_code, emp.full_name
            outcome = employee_service.delete_permanently(db, actor=actor, employee=emp)
            if not outcome.ok:
                print(f"  FAILED delete {code}: {outcome.reason}")
                return 1
            print(f"  deleted {code} {name}")

        # Re-load keepers after the deletes (session may have expired them)
        keepers = db.scalars(
            select(Employee).where(Employee.emp_code.in_(sorted(KEEP_CODES))).order_by(Employee.emp_code)
        ).all()
        org_id = keepers[0].org_id
        for emp in keepers:
            wipe_keeper_history(db, emp)
            restore_keeper_defaults(db, emp)
            leave_service.audit(
                db,
                org_id=emp.org_id,
                actor=actor,
                entity="employee",
                entity_id=emp.id,
                action="history_wiped",
                changes={"emp_code": emp.emp_code},
                note="Mid-month reset: punches, faces, leave, devices cleared; account kept",
            )
            print(f"  wiped   {emp.emp_code} {emp.full_name}")
        accrue_year_to_date(db, org_id)
        db.commit()

        print()
        print("Remaining roster")
        remaining = db.scalars(select(Employee).order_by(Employee.emp_code)).all()
        for emp in remaining:
            _print_row("LIVE", _snapshot(db, emp))
        print(f"\n{len(remaining)} people left. Keepers must sign in again (sessions revoked).")
        print()
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
