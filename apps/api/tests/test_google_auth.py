"""Run: python3 tests/test_google_auth.py

The Google button must not invent an employee. These checks are the rules
the route applies after the token has already been verified.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.google_auth import (  # noqa: E402
    GoogleAuthError,
    classify_google_account,
    verify_firebase_id_token,
)
from app.core.config import settings  # noqa: E402

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


def classify(email, **flags):
    return classify_google_account(
        email,
        domain="holbox.ai",
        has_active_user=flags.get("active", False),
        has_inactive_user=flags.get("inactive", False),
        has_pending=flags.get("pending", False),
    )


print("1. Only a holbox.ai address gets past the door")
check("staff", classify("krish@holbox.ai"), "needs_profile")
check("gmail", classify("krish@gmail.com"), "wrong_domain")
check("other workspace", classify("krish@other.ai"), "wrong_domain")
check("lookalike", classify("krish@holbox.ai.evil.com"), "wrong_domain")
check("empty", classify(""), "wrong_domain")

print("2. An existing person signs in, even if a leftover request is pending")
check("active", classify("nikunj@holbox.ai", active=True, pending=True), "login")

print("3. A closed account stays closed")
check("inactive", classify("old@holbox.ai", inactive=True), "inactive")

print("4. A waiting request does not open the form again")
check("pending", classify("new@holbox.ai", pending=True), "pending")

print("5. Google sign-in stays off until a Firebase project id is set")
previous = settings.firebase_project_id
settings.firebase_project_id = ""
try:
    verify_firebase_id_token("not-a-token")
    check("unconfigured", "returned", "raised")
except GoogleAuthError as exc:
    check("unconfigured", exc.message, "Google sign-in is not configured")
finally:
    settings.firebase_project_id = previous

print()
print("ALL PASS" if ok else "FAILURES - read above")
sys.exit(0 if ok else 1)
