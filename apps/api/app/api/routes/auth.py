"""One login for everybody.

There is no separate admin credential and no public signup. HR creates the
account; what you can do comes from the role on it. Two login systems means two
sets of credentials to disable the day someone leaves, and that is exactly the
one that gets forgotten.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import (
    ACCESS, REFRESH, TokenError, create_token_pair, decode_token,
    hash_password, verify_password,
)
from app.db.session import get_db
from app.models.auth import RefreshSession
from app.models.employee import Employee, User
from app.services import devices

router = APIRouter(prefix="/auth", tags=["auth"])

# One message for "no such email" and "wrong password" alike. Distinguishing
# them tells an attacker which addresses are real.
BAD_CREDENTIALS = "Email or password is incorrect"

MIN_PASSWORD_LENGTH = 10


class LoginRequest(BaseModel):
    # Plain str, not EmailStr. The only question that matters is whether this
    # matches an account we created, and a format check that is stricter than
    # whatever HR typed in would reject a real person for no benefit.
    email: str
    password: str
    # Sent by the phone, absent from the dashboard. Presence of an install_id
    # is what makes a login "on a phone" and triggers binding.
    install_id: str | None = None
    platform: str | None = None
    device_model: str | None = None


class Identity(BaseModel):
    user_id: uuid.UUID
    email: str
    role: str
    employee_id: uuid.UUID | None
    employee_code: str | None
    full_name: str | None
    can_punch: bool
    is_admin: bool
    correction_limit: int = 5
    avatar_url: str | None = None
    face_enrolled: bool = False


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    identity: Identity


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class SetPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class SignupRequestIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=200)
    # Required on the password form. Absent when the person arrived from
    # Continue with Google — that path proves the email with id_token instead.
    password: str | None = Field(default=None, max_length=128)
    id_token: str | None = None
    phone: str | None = None
    desired_department: str | None = None
    desired_designation: str | None = None


class GoogleLoginRequest(BaseModel):
    id_token: str


class SignupResponse(BaseModel):
    ok: bool
    message: str


def _identity(db: Session, user: User) -> Identity:
    emp = db.get(Employee, user.employee_id) if user.employee_id else None
    from app.api.deps import RANK
    from app.models.enums import UserRole
    from app.services.enrolment import active_enrolment

    enrol = active_enrolment(db, emp) if emp else None
    avatar_url = f"/api/gateway/api/v1/employees/{emp.emp_code}/photo" if (emp and enrol) else None

    return Identity(
        user_id=user.id,
        email=user.email,
        role=user.role.value,
        employee_id=emp.id if emp else None,
        employee_code=emp.emp_code if emp else None,
        full_name=emp.full_name if emp else None,
        # rules and get them subtly different. An admin can punch.
        can_punch=emp is not None and emp.is_active,
        is_admin=RANK.get(user.role, -1) >= RANK[UserRole.HR_ADMIN],
        correction_limit=emp.correction_limit if emp and emp.correction_limit is not None else 5,
        avatar_url=avatar_url,
        face_enrolled=bool(enrol is not None),
    )


def _issue(db: Session, user: User, install_id: str | None) -> LoginResponse:
    from app.core.config import settings

    pair = create_token_pair(
        user_id=user.id, role=user.role.value, employee_id=user.employee_id
    )
    db.add(RefreshSession(
        id=pair.refresh_jti, user_id=user.id,
        expires_at=pair.refresh_expires_at, install_id=install_id,
    ))
    return LoginResponse(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=settings.access_token_minutes * 60,
        identity=_identity(db, user),
    )


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    email_clean = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email_clean))
    if user is None:
        if email_clean.endswith("@boxcode.ai"):
            alt = email_clean.replace("@boxcode.ai", "@holbox.ai")
            user = db.scalar(select(User).where(User.email == alt))
        elif email_clean.endswith("@holbox.ai"):
            alt = email_clean.replace("@holbox.ai", "@boxcode.ai")
            user = db.scalar(select(User).where(User.email == alt))
        else:
            emp = db.scalar(select(Employee).where(
                (Employee.email == email_clean) | (Employee.emp_code == email_clean.upper())
            ))
            if emp is not None:
                user = db.scalar(select(User).where(User.employee_id == emp.id))

    # Verify even when the user is missing, against a throwaway hash, so a
    # wrong email and a wrong password take the same time to answer.
    stored = user.password_hash if user else hash_password("timing-equaliser")
    if not verify_password(body.password, stored) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated")

    if body.install_id and user.employee_id:
        employee = db.get(Employee, user.employee_id)
        if employee is not None:
            devices.bind(
                db, employee=employee, install_id=body.install_id,
                platform=body.platform or "unknown", model=body.device_model,
            )

    response = _issue(db, user, body.install_id)
    db.commit()
    return response


def _emails_for(email: str) -> list[str]:
    """The address, plus the old boxcode.ai twin we still have on some rows."""
    emails = [email]
    if email.endswith("@holbox.ai"):
        emails.append(email.replace("@holbox.ai", "@boxcode.ai"))
    elif email.endswith("@boxcode.ai"):
        emails.append(email.replace("@boxcode.ai", "@holbox.ai"))
    return emails


@router.post("/google")
def google_login(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Continue with Google.

    The token is checked here. A known active account gets the same session
    as a password login. A pending request is told to wait. A new holbox.ai
    address is sent to the join form and is not created.
    """
    from app.core.config import settings
    from app.models.enums import SignupStatus
    from app.models.signup_request import SignupRequest
    from app.services.google_auth import (
        GoogleAuthError, classify_google_account, verify_firebase_id_token,
    )

    if not (settings.firebase_project_id or "").strip():
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "Google sign-in is not configured", "code": "unconfigured"},
        )
    try:
        identity = verify_firebase_id_token(body.id_token.strip())
    except GoogleAuthError as exc:
        code = status.HTTP_503_SERVICE_UNAVAILABLE if "not configured" in exc.message else status.HTTP_401_UNAUTHORIZED
        return JSONResponse(status_code=code, content={"detail": exc.message, "code": "invalid"})

    email = identity.email
    user = None
    for candidate in _emails_for(email):
        user = db.scalar(select(User).where(User.email == candidate))
        if user is not None:
            break
    pending = db.scalar(
        select(SignupRequest).where(
            SignupRequest.email.in_(_emails_for(email)),
            SignupRequest.status == SignupStatus.PENDING,
        )
    ) is not None
    outcome = classify_google_account(
        email,
        domain=settings.google_hosted_domain,
        has_active_user=user is not None and user.is_active,
        has_inactive_user=user is not None and not user.is_active,
        has_pending=pending,
    )
    if outcome == "login":
        assert user is not None
        response = _issue(db, user, None)
        db.commit()
        return JSONResponse(content=response.model_dump(mode="json"))

    messages = {
        "wrong_domain": (
            status.HTTP_403_FORBIDDEN,
            "Use your holbox.ai Google account. Other Gmail addresses are not accepted.",
        ),
        "inactive": (
            status.HTTP_403_FORBIDDEN,
            "This account has been deactivated",
        ),
        "pending": (
            status.HTTP_409_CONFLICT,
            "Your request is waiting for an admin to approve it. We'll email you, then sign in with Google again.",
        ),
        "needs_profile": (
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Tell us your name and phone so an admin can approve you.",
        ),
    }
    http_status, message = messages[outcome]
    return JSONResponse(
        status_code=http_status,
        content={"detail": message, "code": outcome, "email": email, "name": identity.name},
    )


@router.post("/refresh", response_model=LoginResponse)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)) -> LoginResponse:
    try:
        claims = decode_token(body.refresh_token, expect=REFRESH)
    except TokenError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Session is not valid - sign in again"
        ) from exc

    session = db.get(RefreshSession, uuid.UUID(claims["jti"]))
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session not recognised")
    if session.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session has been signed out")

    user = db.get(User, uuid.UUID(claims["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is no longer active")

    if session.install_id and user.employee_id:
        employee = db.get(Employee, user.employee_id)
        if employee is not None:
            devices.check(db, employee=employee, install_id=session.install_id)

    # Rotate: the old refresh token stops working the moment a new one is
    # issued, so a stolen one is usable at most until the real phone refreshes.
    session.revoked_at = datetime.now(timezone.utc)
    response = _issue(db, user, session.install_id)
    db.commit()
    return response


@router.post("/logout")
def logout(body: LogoutRequest, db: Session = Depends(get_db)) -> dict:
    """Signing out is idempotent and never reports whether the token was real.

    A caller who has just been signed out has no business learning anything
    from the attempt, and a client retrying a logout should not see an error.
    """
    try:
        claims = decode_token(body.refresh_token, expect=REFRESH)
    except TokenError:
        return {"signed_out": True}

    session = db.get(RefreshSession, uuid.UUID(claims["jti"]))
    if session is not None and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return {"signed_out": True}


@router.get("/me", response_model=Identity)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Identity:
    return _identity(db, user)


@router.post("/set-password")
def set_password(
    body: SetPasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Change your own password - the second half of a first-time invite.

    HR creates the account with a temporary password and hands it over; the
    person signs in with it and immediately replaces it here. That keeps the
    invite flow to one endpoint and means a temporary password is never
    mailed to an address we have not verified.
    """
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different")

    user.password_hash = hash_password(body.new_password)

    # Every other session belonging to this person stops working. If the reason
    # for the change is "someone else knows it", leaving their sessions alive
    # defeats the entire exercise.
    now = datetime.now(timezone.utc)
    for session in db.scalars(
        select(RefreshSession).where(
            RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None)
        )
    ).all():
        session.revoked_at = now
    db.commit()
    return {"changed": True, "other_sessions_signed_out": True}


@router.post("/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequestIn, db: Session = Depends(get_db)) -> SignupResponse:
    from app.models.org import Organization
    from app.models.signup_request import SignupRequest
    from app.models.enums import SignupStatus
    from app.services import notifications, slack

    import secrets

    from app.core.config import settings
    from app.services.google_auth import GoogleAuthError, verify_firebase_id_token

    full_name = body.full_name.strip()
    id_token = (body.id_token or "").strip()
    password = (body.password or "").strip()
    via_google = False

    if id_token:
        # The form can display any email it likes. The token decides.
        try:
            identity = verify_firebase_id_token(id_token)
        except GoogleAuthError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, exc.message) from exc
        domain = (settings.google_hosted_domain or "holbox.ai").strip().lower().lstrip("@")
        if not identity.email.endswith("@" + domain):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Use your holbox.ai Google account. Other Gmail addresses are not accepted.",
            )
        email = identity.email
        via_google = True
        # The column is required. This person never sees the secret; they
        # come back through Continue with Google.
        password_hash = hash_password(secrets.token_urlsafe(32))
    else:
        email = body.email.strip().lower()
        if len(password) < 8:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name, email and password are required")
        password_hash = hash_password(password)

    if not full_name or not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Name, email and password are required")

    # Verify if user already exists, including the old boxcode.ai address.
    existing_user = None
    for candidate in _emails_for(email):
        existing_user = db.scalar(select(User).where(User.email == candidate))
        if existing_user is not None:
            break
    if existing_user is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "An account with this email address already exists. Please sign in.",
        )

    # Verify if pending signup request already exists
    existing_req = db.scalar(
        select(SignupRequest).where(
            SignupRequest.email.in_(_emails_for(email)),
            SignupRequest.status == SignupStatus.PENDING,
        )
    )
    if existing_req is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A registration request for this email is already awaiting admin approval.",
        )

    # Get primary organization
    org = db.scalar(select(Organization))
    if org is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "No organization configured")

    req = SignupRequest(
        id=uuid.uuid4(),
        org_id=org.id,
        full_name=full_name,
        email=email,
        phone=body.phone.strip() if body.phone else None,
        password_hash=password_hash,
        desired_department=body.desired_department.strip() if body.desired_department else None,
        desired_designation=body.desired_designation.strip() if body.desired_designation else None,
        status=SignupStatus.PENDING,
    )
    db.add(req)
    db.flush()

    # Notify HR Admins in-app
    notifications.notify_hr(
        db,
        org_id=org.id,
        category="employee.signup_request",
        title=f"New Signup Request: {full_name}",
        body=f"{full_name} ({email}) has requested to join as an employee. Review and approve in Directory.",
        data={
            "signup_id": str(req.id),
            "full_name": full_name,
            "email": email,
            "phone": req.phone,
            "desired_department": req.desired_department,
            "desired_designation": req.desired_designation,
        },
    )

    # Dispatch email notification to all Admins (Accounting, Krish, Himesh)
    notifications.send_signup_request_email(
        full_name=full_name,
        email=email,
        phone=req.phone,
        desired_department=req.desired_department,
        desired_designation=req.desired_designation,
    )

    # Dispatch Slack notification alert tagging Himesh
    posted = slack.post_signup_request_alert(
        full_name=full_name,
        email=email,
        phone=req.phone,
        department=req.desired_department,
        designation=req.desired_designation,
        signup_id=str(req.id),
    )
    if posted:
        req.slack_message_ts, req.slack_channel_id = posted

    db.commit()
    if via_google:
        message = (
            "Your request is with the admins. We'll email you when you can sign in with Google."
        )
    else:
        message = (
            "Your registration request has been submitted to Admin. You will be able to sign in once approved."
        )
    return SignupResponse(ok=True, message=message)
