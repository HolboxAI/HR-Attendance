"""Password hashing and JWTs.

Two decisions worth knowing about before you change anything here.

**bcrypt over a SHA-256 digest, not over the raw password.** bcrypt silently
ignores everything past 72 bytes - modern bcrypt raises instead, but either way
a long passphrase is not fully hashed. Digesting first means any length is
covered, and it is what Django's `bcrypt_sha256` and passlib's do. The digest is
base64-encoded rather than raw because bcrypt also stops at the first NUL byte,
which raw SHA-256 output will eventually contain.

**Access tokens carry the role; refresh tokens do not.** A refresh token is
only ever exchanged for a new access token, and that exchange re-reads the user
from the database. So if HR changes someone's role or deactivates them, the
change takes effect within one access-token lifetime (30 minutes) without any
token-revocation machinery. Refresh tokens are revocable because they are
long-lived and stored server-side; see RefreshSession.
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

ALGORITHM = "HS256"

ACCESS = "access"
REFRESH = "refresh"


def _digest(password: str) -> bytes:
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_digest(password), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(_digest(password), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        # A malformed hash in the database must read as "wrong password",
        # never as an exception that a caller might mistake for a pass.
        return False


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    refresh_jti: uuid.UUID
    refresh_expires_at: datetime


def _encode(claims: dict, expires: timedelta, kind: str) -> tuple[str, uuid.UUID, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + expires
    jti = uuid.uuid4()
    payload = {
        **claims,
        "typ": kind,
        "jti": str(jti),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), jti, expires_at


def create_token_pair(
    *, user_id: uuid.UUID, role: str, employee_id: uuid.UUID | None
) -> TokenPair:
    access, _, _ = _encode(
        {
            "sub": str(user_id),
            "role": role,
            "employee_id": str(employee_id) if employee_id else None,
        },
        timedelta(minutes=settings.access_token_minutes),
        ACCESS,
    )
    refresh, jti, expires_at = _encode(
        {"sub": str(user_id)}, timedelta(days=settings.refresh_token_days), REFRESH
    )
    return TokenPair(access, refresh, jti, expires_at)


class TokenError(Exception):
    """Any reason a token cannot be trusted. Callers turn this into a 401."""


def decode_token(token: str, *, expect: str) -> dict:
    """Decode and check the token is the KIND we asked for.

    Checking `typ` is not decoration. Without it a refresh token - which is
    long-lived and sits on disk on the phone - would be accepted anywhere an
    access token is, quietly undoing the short access-token lifetime.
    """
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise TokenError(str(exc)) from exc

    if claims.get("typ") != expect:
        raise TokenError(f"Expected a {expect} token")
    if not claims.get("sub"):
        raise TokenError("Token has no subject")
    return claims
