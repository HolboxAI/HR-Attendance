"""Who is calling, and are they allowed.

Roles STACK. An hr_admin is also a manager is also an employee - so the check
is "at least this rank", never "equals this role". That is not a stylistic
preference: Krish is the super admin and punches in every morning, and Ashley
runs Operations and punches in. The moment role is treated as exclusive, the
people who administer the system lose the ability to use it.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import ACCESS, TokenError, decode_token
from app.db.session import get_db
from app.models.employee import Employee, User
from app.models.enums import UserRole

# auto_error=False so a missing header produces our 401 with a useful message
# rather than FastAPI's bare 403.
bearer = HTTPBearer(auto_error=False)

# Higher number = strictly more access. Every level includes everything below.
RANK: dict[UserRole, int] = {
    UserRole.EMPLOYEE: 0,
    UserRole.MANAGER: 1,
    UserRole.HR_ADMIN: 2,
    UserRole.SUPER_ADMIN: 2,  # Unified Admin access
}


def _unauthorised(detail: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"}
    )


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise _unauthorised("Sign in to continue")
    try:
        # Check standard access token first
        claims = decode_token(creds.credentials, expect=ACCESS)
    except TokenError:
        try:
            # Fallback: Check if this is a valid action punch token
            from jose import jwt
            from app.core.config import settings
            raw_claims = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
            if str(raw_claims.get("typ", "")).startswith("action_punch_"):
                # Synthesize a virtual user if sub is employee ID
                emp_id = _as_uuid(raw_claims["sub"])
                emp = db.get(Employee, emp_id)
                if emp and emp.is_active:
                    # Find user linked to employee or create a minimal User wrapper
                    linked_user = db.scalar(select(User).where(User.employee_id == emp.id, User.is_active.is_(True)))
                    if linked_user:
                        return linked_user
                    # Virtual user fallback for punch
                    return User(
                        id=emp.id,
                        org_id=emp.org_id,
                        employee_id=emp.id,
                        email=emp.email or f"{emp.emp_code}@holbox.ai",
                        password_hash="",
                        role=UserRole.EMPLOYEE,
                        is_active=True,
                    )
        except Exception:
            pass
        raise _unauthorised("Your session is not valid - sign in again")

    user = db.get(User, _as_uuid(claims["sub"]))
    if user is None:
        raise _unauthorised("Account no longer exists")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated")
    return user


def _as_uuid(value: str):
    import uuid
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise _unauthorised("Malformed token subject") from exc


def get_current_employee(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Employee:
    """The employee record behind the login, for anything attendance-related.

    A user without an employee_id is a real possibility - an outside auditor,
    say - and they simply cannot punch. That is a 403, not a crash.
    """
    if user.employee_id is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This login is not linked to an employee record, so it cannot punch",
        )
    employee = db.get(Employee, user.employee_id)
    if employee is None or not employee.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Employee record is inactive")
    return employee


def require_role(minimum: UserRole) -> Callable[..., User]:
    """Dependency factory: caller must be AT LEAST `minimum`."""

    def dependency(user: User = Depends(get_current_user)) -> User:
        if RANK.get(user.role, -1) < RANK[minimum]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Your account does not have access to this",
            )
        return user

    return dependency


def install_id_header(x_install_id: str | None = Header(default=None)) -> str | None:
    """The phone's install identifier, sent as a header rather than a form field.

    A header keeps it out of the punch's form body, where it would look like
    just another client-supplied claim about identity - which is precisely the
    shape of the bug this milestone exists to remove.
    """
    return x_install_id
