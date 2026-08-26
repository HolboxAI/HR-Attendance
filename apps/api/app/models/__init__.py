"""Importing this package registers every table on Base.metadata."""

from app.models.attendance import (  # noqa: F401
    AttendanceDay, Device, DeviceEnrollment, PunchEvent, ShiftAssignment, ShiftTemplate,
)
from app.models.auth import RefreshSession  # noqa: F401
from app.models.employee import Employee, User  # noqa: F401
from app.models.face import FaceEnrollment, MobileDevice  # noqa: F401
from app.models.leave import (  # noqa: F401
    AccrualRun, AuditLog, Holiday, LeaveBalance, LeavePolicy, LeaveRequest, LeaveType,
)
from app.models.org import Department, Location, Organization  # noqa: F401
