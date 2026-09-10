"""What an employee can do with their own leave.

Everything here is scoped to the caller by the token. There is deliberately no
employee parameter on any of it - the same rule the auth milestone established
for punching applies just as well to booking time off.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_employee, get_current_user
from app.core.clock import org_today
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import LeaveStatus
from app.models.leave import LeaveRequest, LeaveType
from app.services import leave as leave_service

router = APIRouter(prefix="/leave", tags=["leave"])


class LeaveTypeOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    annual_quota: float
    is_paid: bool
    requires_proof: bool
    carries_forward: bool


class BalanceOut(BaseModel):
    leave_type_id: uuid.UUID
    code: str
    name: str
    is_paid: bool
    period: str
    opening: float
    accrued: float
    used: float
    available: float
    requires_proof: bool = False


LEAVE_REASON_CATEGORIES = [
    "Personal",
    "Family emergency",
    "Medical/health-related",
    "Family/household responsibility",
    "Other legitimate personal reason",
]


class RequestOut(BaseModel):
    id: uuid.UUID
    leave_type_code: str
    leave_type_name: str
    from_date: date
    to_date: date
    half_day_start: bool
    half_day_end: bool
    days: float
    status: str
    category: str | None = None
    reason: str | None
    decided_note: str | None
    decided_at: datetime | None
    employee_code: str | None = None
    employee_name: str | None = None
    medical_document_required: bool = False
    medical_document_deadline: datetime | None = None
    medical_document_url: str | None = None
    medical_document_submitted_at: datetime | None = None


class ApplyRequest(BaseModel):
    leave_type_code: str
    from_date: date
    to_date: date
    half_day_start: bool = False
    half_day_end: bool = False
    category: str | None = None
    reason: str | None = None


def _types(db: Session, org_id: uuid.UUID) -> list[LeaveType]:
    return list(db.scalars(
        select(LeaveType)
        .where(LeaveType.org_id == org_id, LeaveType.is_active.is_(True),
               LeaveType.deleted_at.is_(None))
        .order_by(LeaveType.sort_order, LeaveType.code)
    ).all())


def to_request_out(db: Session, r: LeaveRequest, emp: Employee | None = None) -> RequestOut:
    lt = db.get(LeaveType, r.leave_type_id)
    emp = emp or db.get(Employee, r.employee_id)
    return RequestOut(
        id=r.id, leave_type_code=lt.code if lt else "?",
        leave_type_name=lt.name if lt else "?",
        from_date=r.from_date, to_date=r.to_date,
        half_day_start=r.half_day_start, half_day_end=r.half_day_end,
        days=float(r.days_consumed), status=r.status.value,
        category=r.category,
        reason=r.reason, decided_note=r.decided_note, decided_at=r.decided_at,
        employee_code=emp.emp_code if emp else None,
        employee_name=emp.full_name if emp else None,
        medical_document_required=r.medical_document_required,
        medical_document_deadline=r.medical_document_deadline,
        medical_document_url=r.medical_document_url,
        medical_document_submitted_at=r.medical_document_submitted_at,
    )


@router.get("/categories")
def leave_categories() -> list[str]:
    return LEAVE_REASON_CATEGORIES


@router.get("/types", response_model=list[LeaveTypeOut])
def types(db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee)):
    return [
        LeaveTypeOut(
            id=t.id, code=t.code, name=t.name, annual_quota=float(t.annual_quota),
            is_paid=t.is_paid, requires_proof=t.requires_proof,
            carries_forward=t.carries_forward,
        )
        for t in _types(db, emp.org_id)
    ]


@router.get("/balance", response_model=list[BalanceOut])
def my_balance(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
):
    pol = leave_service.policy(db, emp.org_id)
    period = leave_service.period_for(pol, org_today())
    out = []
    for t in _types(db, emp.org_id):
        bal = leave_service.balance(db, emp, t, period)
        out.append(BalanceOut(
            leave_type_id=t.id, code=t.code, name=t.name, is_paid=t.is_paid,
            period=period, opening=float(bal.opening), accrued=float(bal.accrued),
            used=float(bal.used), available=bal.available, requires_proof=t.requires_proof,
        ))
    db.commit()
    return out


@router.get("/my-requests", response_model=list[RequestOut])
def my_requests(
    db: Session = Depends(get_db), emp: Employee = Depends(get_current_employee),
):
    rows = db.scalars(
        select(LeaveRequest)
        .where(LeaveRequest.employee_id == emp.id, LeaveRequest.deleted_at.is_(None))
        .order_by(LeaveRequest.from_date.desc())
    ).all()
    return [to_request_out(db, r, emp) for r in rows]


@router.post("/request", response_model=RequestOut)
async def apply(
    request: Request,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
):
    content_type = request.headers.get("content-type", "")
    file_data = None
    file_ext = None
    if "application/json" in content_type:
        body = await request.json()
        leave_type_code = str(body.get("leave_type_code", ""))
        from_date = date.fromisoformat(body["from_date"])
        to_date = date.fromisoformat(body.get("to_date") or body["from_date"])
        half_day_start = bool(body.get("half_day_start", False))
        half_day_end = bool(body.get("half_day_end", False))
        category = body.get("category")
        reason = body.get("reason")
    else:
        form = await request.form()
        leave_type_code = str(form.get("leave_type_code", ""))
        from_date = date.fromisoformat(str(form.get("from_date", "")))
        to_date = date.fromisoformat(str(form.get("to_date") or form.get("from_date", "")))
        half_day_start = str(form.get("half_day_start", "false")).lower() in ("true", "1")
        half_day_end = str(form.get("half_day_end", "false")).lower() in ("true", "1")
        category = form.get("category")
        reason = form.get("reason")
        if reason is not None:
            reason = str(reason)
        file = form.get("file")
        if file and hasattr(file, "read"):
            file_data = await file.read()
            if len(file_data) > 5 * 1024 * 1024:
                raise HTTPException(400, "File too large. Maximum 5MB.")
            file_ext = "pdf" if getattr(file, "content_type", "") == "application/pdf" else "jpg"

    if category is not None:
        category = str(category).strip()
        if category and category not in LEAVE_REASON_CATEGORIES:
            raise HTTPException(422, f"Invalid category. Must be one of: {LEAVE_REASON_CATEGORIES}")

    lt = db.scalar(select(LeaveType).where(
        LeaveType.org_id == emp.org_id, LeaveType.code == leave_type_code.upper(),
        LeaveType.is_active.is_(True), LeaveType.deleted_at.is_(None),
    ))
    if lt is None:
        raise HTTPException(404, f"No leave type {leave_type_code}")

    result = leave_service.submit(
        db, employee=emp, leave_type=lt, start=from_date, end=to_date,
        category=category, reason=reason, half_day_start=half_day_start,
        half_day_end=half_day_end,
    )
    if not result.ok:
        raise HTTPException(409, result.reason or "Could not apply")
        
    db.commit()

    doc_view_url = None
    if file_data and result.request.id:
        from app.services.storage import storage
        key = f"medical_docs/{result.request.id}/doc.{file_ext}"
        storage.put(key, file_data)
        result.request.medical_document_url = key
        result.request.medical_document_submitted_at = datetime.now(timezone.utc)
        db.commit()

        from app.core.security import generate_action_token
        doc_token = generate_action_token("leave_document_view", sub=str(result.request.id), payload={}, expires_hours=168)
        api_url = getattr(settings, "api_url", "https://attendance.holbox.ai/api/v1")
        doc_view_url = f"{api_url}/leave/{result.request.id}/document/view?token={doc_token}"
    
    from app.services import notifications
    
    # We need the User object corresponding to this employee to exclude them from HR notifications
    # if they happen to be an HR Admin themselves.
    from app.models.employee import User
    emp_user = db.scalar(select(User).where(User.employee_id == emp.id))
    
    from app.models.enums import UserRole
    notifications.notify_hr(
        db,
        org_id=emp.org_id,
        category="leave.pending",
        title="Leave Request",
        body=f"{emp.full_name} requested {lt.name} for the dates: {result.request.from_date.strftime('%B %d, %Y')} to {result.request.to_date.strftime('%B %d, %Y')}.",
        exclude_user_id=emp_user.id if emp_user and emp_user.role not in (UserRole.HR_ADMIN, UserRole.SUPER_ADMIN) else None,
        data={
            "leave_request_id": str(result.request.id),
            "doc_view_url": doc_view_url,
            "has_document": bool(doc_view_url),
            "doc_filename": f"medical_doc_{emp.emp_code}.{file_ext}" if file_data else None,
            "doc_bytes": file_data if file_data else None,
        },
    )
    db.commit()
    from app.services.slack import post_leave_request
    from fastapi import BackgroundTasks
    
    is_sick = (lt.code.upper() == "SL" or "sick" in lt.name.lower())
    try:
        slack_resp = post_leave_request(
            leave_request_id=str(result.request.id),
            employee_name=emp.full_name,
            leave_type=lt.name,
            from_date=result.request.from_date,
            to_date=result.request.to_date,
            days=float(result.request.days_consumed),
            reason=result.request.reason or "No reason provided",
            document_url=doc_view_url,
            is_sick_leave=is_sick,
        )
        if slack_resp:
            result.request.slack_message_ts = slack_resp[0]
            result.request.slack_channel_id = slack_resp[1]
            db.commit()
    except Exception:
        pass
        
    return to_request_out(db, result.request, emp)


@router.post("/{request_id}/cancel", response_model=RequestOut)
def cancel(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
    user: User = Depends(get_current_user),
):
    row = db.get(LeaveRequest, request_id)
    # 404 rather than 403 for someone else's request, so the endpoint cannot be
    # used to discover which request ids exist.
    if row is None or row.employee_id != emp.id or row.deleted_at is not None:
        raise HTTPException(404, "No such request")

    result = leave_service.cancel(db, request=row, actor=user)
    if not result.ok:
        db.rollback()
        raise HTTPException(409, result.reason or "Could not cancel")
    db.commit()
    return to_request_out(db, row, emp)


@router.get("/email-decide", response_class=HTMLResponse)
def email_decide(token: str, db: Session = Depends(get_db)):
    """Process a leave decision via an email link."""
    from app.core.security import decode_action_token
    def _glassy_html(title: str, message: str, status_code: int = 200, is_success: bool = True) -> HTMLResponse:
        accent_color = "#10b981" if is_success else "#ef4444"
        icon_svg = (
            '<svg viewBox="0 0 24 24" width="36" height="36" stroke="#10b981" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
            if is_success else
            '<svg viewBox="0 0 24 24" width="36" height="36" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
        )
        auto_close_script = """
        <p id="countdown-text" style="font-size: 12px; color: rgba(255, 255, 255, 0.4); margin-top: 24px; font-family: ui-monospace, monospace;">
          Closing window in <span id="sec" style="color: #ffffff; font-weight: bold;">3</span>s...
        </p>
        <script>
          var sec = 3;
          var t = setInterval(function() {
            sec--;
            var el = document.getElementById('sec');
            if (el) el.innerText = sec;
            if (sec <= 0) {
              clearInterval(t);
              window.close();
            }
          }, 1000);
        </script>
        """ if is_success else ""

        content = f"""<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>{title} · Holbox HRMS</title>
            <style>
                * {{ box-sizing: border-box; }}
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #000000; color: #ffffff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }}
                .card {{ background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 36px 32px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); text-align: center; max-width: 440px; width: 100%; }}
                .icon-wrap {{ width: 68px; height: 68px; margin: 0 auto 20px; border-radius: 50%; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); display: flex; align-items: center; justify-content: center; }}
                h1 {{ color: #ffffff; font-weight: 800; margin: 0 0 12px; font-size: 22px; letter-spacing: -0.02em; }}
                p.lead {{ font-size: 14px; margin: 0 0 24px; color: rgba(255, 255, 255, 0.7); line-height: 1.5; }}
                .btn-group {{ display: flex; gap: 10px; justify-content: center; margin-top: 20px; }}
                .btn {{ display: inline-flex; align-items: center; justify-content: center; padding: 10px 20px; border-radius: 9999px; font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all 0.2s; }}
                .btn-primary {{ background: #ffffff; color: #000000; border: none; }}
                .btn-primary:hover {{ background: rgba(255, 255, 255, 0.85); }}
                .btn-secondary {{ background: rgba(255, 255, 255, 0.08); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.15); }}
                .btn-secondary:hover {{ background: rgba(255, 255, 255, 0.15); }}
            </style>
        </head>
        <body>
            <div class="card">
                <div class="icon-wrap">{icon_svg}</div>
                <h1>{title}</h1>
                <p class="lead">{message}</p>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="window.close()">Close Tab</button>
                    <a class="btn btn-secondary" href="https://attendance.holbox.ai">Dashboard</a>
                </div>
                {auto_close_script}
            </div>
        </body>
        </html>
        """
        return HTMLResponse(content=content, status_code=status_code)

    try:
        claims = decode_action_token(token, "leave_decide")
    except Exception:
        return _glassy_html("Link Expired", "This action link is invalid or has expired.", 400, is_success=False)
    
    request_id = claims["sub"]
    approve = claims["approve"]
    approver_id = uuid.UUID(claims["approver_id"])
    
    row = db.get(LeaveRequest, uuid.UUID(request_id))
    if not row or row.deleted_at is not None:
        return _glassy_html("Not Found", "Leave request was not found or was cancelled.", 404, is_success=False)
        
    approver = db.get(User, approver_id)
    if not approver:
        return _glassy_html("Not Found", "Approver account not found.", 404, is_success=False)
        
    # Process decision
    actor_label = approver.email.split('@')[0] if approver.email else "Admin"
    result = leave_service.decide(
        db,
        request=row,
        approver=approver,
        approve=approve,
        note=f"Decided via Email by @{actor_label}",
    )
    if not result.ok:
        db.rollback()
        return _glassy_html("Already Decided", f"{result.reason}", 409, is_success=False)
        
    db.commit()
    action = "Approved" if approve else "Rejected"
    return _glassy_html(
        f"Leave Request {action}",
        f"You have successfully {action.lower()} this request. Slack and all platform records have been synced automatically.",
        200,
        is_success=True,
    )


@router.post("/{request_id}/document", response_model=RequestOut)
def upload_document(
    request_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    emp: Employee = Depends(get_current_employee),
):
    row = db.get(LeaveRequest, request_id)
    if row is None or row.employee_id != emp.id or row.deleted_at is not None:
        raise HTTPException(404, "No such request")
        
    if row.status != LeaveStatus.PARTIALLY_APPROVED:
        raise HTTPException(409, "Cannot upload document: request is not partially approved")
        
    from app.services.storage import storage
    
    ext = "pdf" if file.content_type == "application/pdf" else "jpg"
    key = f"medical_docs/{row.id}/doc.{ext}"
    data = file.file.read()
    storage.put(key, data)
    
    row.medical_document_url = key
    row.medical_document_submitted_at = datetime.now(timezone.utc)
    db.commit()

    from app.core.security import generate_action_token
    doc_token = generate_action_token("leave_document_view", sub=str(row.id), payload={}, expires_hours=168)
    api_url = getattr(settings, "api_url", "https://attendance.holbox.ai/api/v1")
    doc_view_url = f"{api_url}/leave/{row.id}/document/view?token={doc_token}"

    from app.services.slack import post_document_uploaded_alert
    try:
        lt = db.get(LeaveType, row.leave_type_id)
        post_document_uploaded_alert(
            leave_request_id=str(row.id),
            employee_name=emp.full_name,
            leave_type_name=lt.name if lt else "Sick Leave",
            from_date=row.from_date,
            to_date=row.to_date,
            document_url=doc_view_url,
            original_channel_id=row.slack_channel_id,
            original_thread_ts=row.slack_message_ts,
        )
    except Exception:
        pass

    from app.services import notifications
    from app.models.employee import User
    from app.models.enums import UserRole
    
    emp_user = db.scalar(select(User).where(User.employee_id == emp.id))
    
    notifications.notify_hr(
        db,
        org_id=emp.org_id,
        category="leave.document_uploaded",
        title="Medical Document Uploaded",
        body=f"{emp.full_name} has submitted the required medical document for their leave request ({row.from_date} to {row.to_date}).",
        exclude_user_id=emp_user.id if emp_user and emp_user.role != UserRole.HR_ADMIN else None,
        data={
            "leave_request_id": str(row.id),
            "doc_view_url": doc_view_url,
            "has_document": True,
            "doc_filename": f"medical_doc_{emp.emp_code}.{ext}",
            "doc_bytes": data,
        },
    )
    db.commit()

    return to_request_out(db, row, emp)


@router.get("/{request_id}/document/view")
def view_document_with_token(
    request_id: uuid.UUID,
    token: str = Query(..., description="Action token for secure viewing without session"),
    db: Session = Depends(get_db),
):
    """Direct inline viewing of leave document with action token (for Slack & Email)."""
    from app.core.security import decode_action_token
    try:
        claims = decode_action_token(token, "leave_document_view")
        if claims.get("sub") != str(request_id):
            raise HTTPException(403, "Invalid token for this document")
    except Exception:
        raise HTTPException(403, "Invalid or expired document link")

    row = db.get(LeaveRequest, request_id)
    if row is None or row.deleted_at is not None or not row.medical_document_url:
        raise HTTPException(404, "Document not found")

    from app.services.storage import storage
    data = storage.get(row.medical_document_url)
    if not data:
        raise HTTPException(404, "Document file not found in storage")

    content_type = "application/pdf" if row.medical_document_url.endswith(".pdf") else "image/jpeg"
    if row.medical_document_url.endswith(".png"):
        content_type = "image/png"

    filename = f"medical_doc_{row.id}.{'pdf' if content_type == 'application/pdf' else 'jpg'}"
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{request_id}/document/download")
def download_document(
    request_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = db.get(LeaveRequest, request_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(404, "No such request")
        
    # Check permissions (either the employee themselves or an HR admin/manager)
    if row.employee_id != user.employee_id and user.role not in [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER]:
        raise HTTPException(403, "Not authorized to view this document")
        
    if not row.medical_document_url:
        raise HTTPException(404, "No document attached to this request")
        
    from app.services.storage import storage
    data = storage.get(row.medical_document_url)
    if not data:
        raise HTTPException(404, "Document file not found in storage")
        
    from fastapi.responses import Response
    
    # Very basic content type inference
    content_type = "application/pdf" if row.medical_document_url.endswith(".pdf") else "image/jpeg"
    if row.medical_document_url.endswith(".png"):
        content_type = "image/png"
        
    return Response(content=data, media_type=content_type)
