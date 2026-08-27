"""Create login accounts for the team.

    python scripts/seed_users.py                  create anyone missing
    python scripts/seed_users.py --reset-password krish@boxcode.ai

Passwords are generated here, printed ONCE, and never stored anywhere but as a
bcrypt hash. There is no way to read one back - if it scrolls past, reset it.
That is deliberate: a password this script could recover is a password sitting
in the repo.

Roles stack. Krish is super_admin and Ashley is hr_admin, and both are linked
to their employee records, so both still punch in every morning like everyone
else. Everyone else gets `employee`.
"""
import secrets
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                        # noqa: E402

from app.core.security import hash_password          # noqa: E402
from app.db.session import SessionLocal              # noqa: E402
from app.models.employee import Employee, User       # noqa: E402
from app.models.enums import UserRole                # noqa: E402

# emp_code -> role. Anyone not listed is a plain employee.
ROLES = {
    "BX001": UserRole.SUPER_ADMIN,     # Krish
    "BX006": UserRole.HR_ADMIN,        # Ashley, Operations
    "BX008": UserRole.HR_ADMIN,        # Himesh, Holbox - same access as Ashley
}

# Readable rather than maximally random: these get typed once, on a phone,
# from a note handed over in person, and then replaced via /auth/set-password.
WORDS = (
    "anchor bridge cobalt dahlia ember fathom granite harbour indigo juniper "
    "kestrel lantern marigold nutmeg opal parsley quartz rhubarb saffron thistle"
).split()


def new_password() -> str:
    return "-".join(secrets.choice(WORDS) for _ in range(3)) + f"-{secrets.randbelow(90) + 10}"


def main() -> None:
    db = SessionLocal()
    try:
        if "--reset-password" in sys.argv:
            email = sys.argv[sys.argv.index("--reset-password") + 1].lower()
            user = db.scalar(select(User).where(User.email == email))
            if user is None:
                print(f"No account for {email}")
                sys.exit(1)
            pw = new_password()
            user.password_hash = hash_password(pw)
            db.commit()
            print(f"\n  {email}\n  new password: {pw}\n\nShown once. Not recoverable.\n")
            return

        employees = db.scalars(select(Employee).order_by(Employee.emp_code)).all()
        if not employees:
            print("No employees yet - run scripts/seed.py first.")
            sys.exit(1)

        created: list[tuple[str, str, str]] = []
        for emp in employees:
            if not emp.email:
                print(f"skip      : {emp.emp_code} {emp.full_name} has no email address")
                continue
            existing = db.scalar(select(User).where(User.email == emp.email.lower()))
            if existing is not None:
                continue
            pw = new_password()
            db.add(User(
                id=uuid.uuid4(), org_id=emp.org_id, employee_id=emp.id,
                email=emp.email.lower(), password_hash=hash_password(pw),
                role=ROLES.get(emp.emp_code, UserRole.EMPLOYEE), is_active=True,
            ))
            created.append((emp.email.lower(), ROLES.get(emp.emp_code, UserRole.EMPLOYEE).value, pw))

        db.commit()
        total = len(db.scalars(select(User)).all())

        if created:
            print("\n  NEW ACCOUNTS - these passwords are shown once and are not")
            print("  recoverable. Hand them over in person, then have each person")
            print("  change theirs with POST /auth/set-password.\n")
            width = max(len(e) for e, _, _ in created)
            for email, role, pw in created:
                print(f"    {email:<{width}}  {role:<12}  {pw}")
            print()
        else:
            print("accounts  : nothing to create, everyone already has one")

        print(f"users     : {total} total, {len(created)} created this run")
    finally:
        db.close()


if __name__ == "__main__":
    main()
