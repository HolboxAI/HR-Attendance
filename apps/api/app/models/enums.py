from enum import Enum


class PunchSource(str, Enum):
    """Where a punch came from. The core treats all of these identically."""

    GATE_DEVICE = "gate_device"     # biometric / RFID reader at the gate
    MOBILE_APP = "mobile_app"       # selfie + face match + geofence
    WEB_KIOSK = "web_kiosk"         # tablet at reception, rotating QR
    MANUAL = "manual"               # HR entered it; always audited
    IMPORT = "import"               # bulk CSV backfill


class PunchDirection(str, Enum):
    IN = "in"
    OUT = "out"
    UNKNOWN = "unknown"             # cheap readers don't report it; resolver infers


class AttendanceStatus(str, Enum):
    PRESENT = "present"
    HALF_DAY = "half_day"
    ABSENT = "absent"
    WEEKLY_OFF = "weekly_off"
    HOLIDAY = "holiday"
    ON_LEAVE = "on_leave"
    NOT_MARKED = "not_marked"       # shift in progress or no data yet


class EmploymentType(str, Enum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERN = "intern"


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    HR_ADMIN = "hr_admin"
    MANAGER = "manager"
    EMPLOYEE = "employee"
