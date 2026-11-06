"""Verify a Firebase Google sign-in and decide which door it opens.

The browser only brings a token. The email inside it counts after Google's
signature checks out. A matching employee signs in. A pending request waits.
Anything else is a join form, not an account.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import httpx
from jose import JWTError, jwt

from app.core.config import settings

_CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
_lock = threading.Lock()
_certs: dict[str, str] = {}
_certs_until: float = 0.0


class GoogleAuthError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class GoogleIdentity:
    email: str
    name: str | None


def classify_google_account(
    email: str,
    *,
    domain: str,
    has_active_user: bool,
    has_inactive_user: bool,
    has_pending: bool,
) -> str:
    """login, inactive, pending, needs_profile, or wrong_domain.

    Pure: no database and no call to Google. The route applies the result.
    """
    allowed = domain.strip().lower().lstrip("@")
    address = email.strip().lower()
    if "@" not in address or not address.endswith("@" + allowed):
        return "wrong_domain"
    if has_active_user:
        return "login"
    if has_inactive_user:
        return "inactive"
    if has_pending:
        return "pending"
    return "needs_profile"


def verify_firebase_id_token(id_token: str) -> GoogleIdentity:
    """Check a Firebase ID token against Google's public certificates.

    No service-account private key. The project id is the audience, so a
    token minted for some other Firebase project is refused.
    """
    project = (settings.firebase_project_id or "").strip()
    if not project:
        raise GoogleAuthError("Google sign-in is not configured")
    if not id_token or id_token.count(".") != 2:
        raise GoogleAuthError("Google sign-in could not be verified. Try again.")

    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise GoogleAuthError("Google sign-in could not be verified. Try again.") from exc
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not kid:
        raise GoogleAuthError("Google sign-in could not be verified. Try again.")

    try:
        certs = _certificates()
        key = certs.get(str(kid))
        if key is None:
            certs = _certificates(force=True)
            key = certs.get(str(kid))
        if key is None:
            raise GoogleAuthError("Google sign-in could not be verified. Try again.")
        payload = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=project,
            issuer=f"https://securetoken.google.com/{project}",
            options={"leeway": 60},
        )
    except GoogleAuthError:
        raise
    except (JWTError, httpx.HTTPError) as exc:
        raise GoogleAuthError("Google sign-in could not be verified. Try again.") from exc

    email = str(payload.get("email") or "").strip().lower()
    verified = payload.get("email_verified")
    if verified is not True and str(verified).lower() != "true":
        raise GoogleAuthError("That Google account has not verified its email.")
    firebase = payload.get("firebase") or {}
    if firebase.get("sign_in_provider") != "google.com":
        raise GoogleAuthError("Sign in with Google, using your holbox.ai account.")
    if not email:
        raise GoogleAuthError("Google did not share an email for this account.")
    raw_name = payload.get("name")
    name = str(raw_name).strip() if raw_name else ""
    return GoogleIdentity(email=email, name=name or None)


def _certificates(*, force: bool = False) -> dict[str, str]:
    global _certs, _certs_until
    now = time.time()
    with _lock:
        if not force and _certs and now < _certs_until:
            return dict(_certs)
        response = httpx.get(_CERTS_URL, timeout=5.0)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or not data:
            raise GoogleAuthError("Google sign-in could not be verified. Try again.")
        _certs = {str(key): str(value) for key, value in data.items()}
        _certs_until = now + _cache_ttl(response.headers.get("cache-control", ""))
        return dict(_certs)


def _cache_ttl(cache_control: str) -> int:
    ttl = 3600
    for part in cache_control.split(","):
        piece = part.strip().lower()
        if piece.startswith("max-age="):
            try:
                ttl = int(piece.split("=", 1)[1])
            except ValueError:
                pass
    return max(60, min(ttl, 6 * 3600))
