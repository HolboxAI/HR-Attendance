"""Phone binding: one handset per employee.

The face check answers "is this the right face". Binding answers a different
question - "is this the right phone" - and it is the cheaper of the two. Two
people cannot share one login and punch from their own handsets, and a stolen
password is not enough on its own.

The awkward case is the honest one: people genuinely change phones. So a
binding is not permanent, it is *withdrawable by HR*, and withdrawing it leaves
a row behind. That is the whole design - make the common case safe and the
exceptional case possible-but-visible.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.face import MobileDevice

# Said to the employee. Deliberately does not say whose phone it is.
OTHER_PERSONS_PHONE = "This phone is registered to another employee"
ALREADY_BOUND = (
    "Your account is already set up on a different phone. "
    "Ask HR to remove the old one."
)
NOT_BOUND = "This phone is not registered. Sign in again to register it."


@dataclass(frozen=True)
class BindResult:
    ok: bool
    device: MobileDevice | None = None
    reason: str | None = None


def active_binding(db: Session, employee: Employee) -> MobileDevice | None:
    return db.scalar(
        select(MobileDevice).where(
            MobileDevice.employee_id == employee.id,
            MobileDevice.is_active.is_(True),
        )
    )


def bind(
    db: Session,
    *,
    employee: Employee,
    install_id: str,
    platform: str = "unknown",
    model: str | None = None,
) -> BindResult:
    """Attach this install to this employee.
    
    Device binding restrictions are disabled - employees can freely log in and punch
    from any device or browser without being blocked.
    """
    now = datetime.now(timezone.utc)
    existing = db.scalar(select(MobileDevice).where(MobileDevice.install_id == install_id))

    if existing is not None and existing.employee_id != employee.id:
        existing.employee_id = employee.id

    if existing is None:
        existing = MobileDevice(
            employee_id=employee.id, install_id=install_id,
            platform=platform, model=model,
        )
        db.add(existing)

    existing.is_active = True
    existing.platform = platform or existing.platform
    existing.model = model or existing.model
    existing.last_seen_at = now
    db.flush()
    return BindResult(True, existing)


def check(db: Session, *, employee: Employee, install_id: str | None) -> BindResult:
    """Verify device. Always succeeds as device binding enforcement is disabled."""
    if not install_id:
        return BindResult(True, None)

    device = db.scalar(
        select(MobileDevice).where(
            MobileDevice.install_id == install_id,
        )
    )
    if device is not None:
        device.employee_id = employee.id
        device.is_active = True
        device.last_seen_at = datetime.now(timezone.utc)
        return BindResult(True, device)

    # If it's a new device/browser, register it on the fly
    return bind(db, employee=employee, install_id=install_id, platform="web" if install_id.startswith("web-") else "unknown")


def clear(db: Session, employee: Employee) -> bool:
    """HR removing a binding so someone can set up a new handset.

    Deactivates rather than deletes: the record that this employee once used
    this install, and that someone withdrew it, is worth keeping.
    """
    device = active_binding(db, employee)
    if device is None:
        return False
    device.is_active = False
    db.flush()
    return True
