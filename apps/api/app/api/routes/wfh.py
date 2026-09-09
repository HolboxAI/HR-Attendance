from datetime import date
from typing import Annotated, Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, require_role, get_current_user
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import UserRole, CorrectionStatus, AttendanceStatus
from app.models.wfh_request import WFHRequest
from app.services.attendance import recompute_day

require_admin = require_role(UserRole.HR_ADMIN)

router = APIRouter()

# -----------------
# Admin Config
# -----------------

class WFHConfigUpdate(BaseModel):
    employee_ids: list[uuid.UUID]
    is_wfh_enabled: bool

@router.put("/admin/wfh-config", tags=["admin"])
def update_wfh_config(
    payload: WFHConfigUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    employees = db.scalars(
        select(Employee).where(
            and_(
                Employee.org_id == admin.org_id,
                Employee.id.in_(payload.employee_ids),
            )
        )
    ).all()
    
    from app.services.notifications import notify

    updated = 0
    for emp in employees:
        was_enabled = emp.is_wfh_enabled
        emp.is_wfh_enabled = payload.is_wfh_enabled
        updated += 1

        if was_enabled != payload.is_wfh_enabled:
            user = db.scalar(select(User).where(User.employee_id == emp.id))
            if user:
                if payload.is_wfh_enabled:
                    notify(
                        db,
                        org_id=admin.org_id,
                        user=user,
                        category="wfh.assigned",
                        title="Work From Home Assigned",
                        body="You are assigned to Work From Home. You can now check in remotely.",
                        data={"employee_id": str(emp.id), "status": "enabled"},
                    )
                else:
                    notify(
                        db,
                        org_id=admin.org_id,
                        user=user,
                        category="wfh.assigned",
                        title="Work From Home Removed",
                        body="Your Work From Home access has been removed by an administrator.",
                        data={"employee_id": str(emp.id), "status": "disabled"},
                    )
    
    db.commit()
    return {"updated": updated}

@router.get("/admin/wfh-config", tags=["admin"])
def list_wfh_config(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    employees = db.scalars(
        select(Employee)
        .where(Employee.org_id == admin.org_id)
        .order_by(Employee.full_name)
    ).all()
    
    return [
        {
            "id": e.id,
            "emp_code": e.emp_code,
            "full_name": e.full_name,
            "is_wfh_enabled": e.is_wfh_enabled,
        }
        for e in employees
    ]

# -----------------
# Admin WFH Requests
# -----------------

@router.get("/admin/wfh/pending", tags=["admin"])
def list_pending_wfh(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    requests = db.scalars(
        select(WFHRequest)
        .where(
            and_(
                WFHRequest.org_id == admin.org_id,
                WFHRequest.status == CorrectionStatus.PENDING,
            )
        )
        .order_by(WFHRequest.shift_date)
    ).all()
    
    employee_ids = {r.employee_id for r in requests}
    employees = {
        e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all()
    }
    
    return [
        {
            "id": r.id,
            "shift_date": r.shift_date.isoformat(),
            "reason": r.reason,
            "created_at": r.created_at.isoformat(),
            "employee": {
                "id": employees[r.employee_id].id,
                "full_name": employees[r.employee_id].full_name,
                "emp_code": employees[r.employee_id].emp_code,
            } if r.employee_id in employees else None,
        }
        for r in requests
    ]

class WFHDecision(BaseModel):
    status: CorrectionStatus
    note: str | None = None

@router.post("/admin/wfh/{request_id}/decide", tags=["admin"])
def decide_wfh_request(
    request_id: uuid.UUID,
    payload: WFHDecision,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.status not in (CorrectionStatus.APPROVED, CorrectionStatus.REJECTED):
        raise HTTPException(400, "Decision must be approved or rejected")

    wfh_req = db.scalar(
        select(WFHRequest).where(
            and_(
                WFHRequest.id == request_id,
                WFHRequest.org_id == admin.org_id,
                WFHRequest.status == CorrectionStatus.PENDING,
            )
        )
    )
    if not wfh_req:
        raise HTTPException(404, "Pending request not found")

    wfh_req.status = payload.status
    wfh_req.decided_by_id = admin.id
    from datetime import datetime, timezone
    wfh_req.decided_at = datetime.now(timezone.utc)
    wfh_req.decided_note = payload.note
    
    db.flush()
    
    # Recompute attendance if the shift date is today or in the past
    # because they might have already punched in and were marked absent due to geofence
    emp = db.scalar(select(Employee).where(Employee.id == wfh_req.employee_id))
    if emp and wfh_req.shift_date <= datetime.now(timezone.utc).date():
        recompute_day(db, emp, wfh_req.shift_date)
        
    from app.services.notifications import notify
    user_emp = db.scalar(select(User).where(User.employee_id == wfh_req.employee_id))
    if user_emp:
        notify(
            db,
            org_id=admin.org_id,
            user=user_emp,
            category="wfh.decided",
            title="WFH Request Decided",
            body=f"Your WFH request for {wfh_req.shift_date} was {wfh_req.status.value}",
            data={"wfh_request_id": str(wfh_req.id)}
        )

    # Mark the pending notifications as read for all admins
    from app.models.notification import Notification
    pending_notifs = db.scalars(
        select(Notification).where(
            Notification.org_id == admin.org_id,
            Notification.category == "wfh.pending",
            Notification.read_at.is_(None),
        )
    ).all()
    now_utc = datetime.now(timezone.utc)
    for n in pending_notifs:
        if n.data and str(n.data.get("wfh_request_id")) == str(wfh_req.id):
            n.read_at = now_utc
        
    db.commit()
    return {"ok": True}

# -----------------
# Employee (Mobile App)
# -----------------

class WFHRequestCreate(BaseModel):
    shift_date: date
    reason: str = Field(..., max_length=500)

@router.post("/wfh/request", tags=["mobile"])
def create_wfh_request(
    payload: WFHRequestCreate,
    emp: Employee = Depends(get_current_employee),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    # Ensure they don't already have one
    existing = db.scalar(
        select(WFHRequest).where(
            and_(
                WFHRequest.employee_id == emp.id,
                WFHRequest.shift_date == payload.shift_date,
            )
        )
    )
    if existing:
        raise HTTPException(400, "A WFH request for this date already exists")
        
    req = WFHRequest(
        org_id=emp.org_id,
        employee_id=emp.id,
        shift_date=payload.shift_date,
        reason=payload.reason,
        status=CorrectionStatus.PENDING,
    )
    db.add(req)
    db.flush()

    # Notify all admins (HR_ADMIN + SUPER_ADMIN)
    from app.services.notifications import notify_hr
    notify_hr(
        db,
        org_id=emp.org_id,
        category="wfh.pending",
        title="WFH Request",
        body=f"{emp.full_name} requested Work From Home for {payload.shift_date}",
        data={"wfh_request_id": str(req.id)},
    )

    db.commit()
    return {"id": req.id}

@router.get("/wfh", tags=["mobile"])
def list_my_wfh(
    emp: Employee = Depends(get_current_employee),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    requests = db.scalars(
        select(WFHRequest)
        .where(WFHRequest.employee_id == emp.id)
        .order_by(WFHRequest.shift_date.desc())
        .limit(30)
    ).all()
    
    return [
        {
            "id": r.id,
            "shift_date": r.shift_date.isoformat(),
            "reason": r.reason,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        }
        for r in requests
    ]
