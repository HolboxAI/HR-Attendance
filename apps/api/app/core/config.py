from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# repo_root/data - everything the prototype writes lives here and nowhere else.
REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_DIR = REPO_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Prototype: a single SQLite file. Production: swap this one string for a
    # postgresql+psycopg:// URL. The models are dialect-portable, so nothing
    # else changes.
    database_url: str = f"sqlite:///{DATA_DIR / 'boxcode.db'}"

    jwt_secret: str = "dev-only-change-before-anyone-real-uses-this"

    # 30 minutes is short enough that a role change or a deactivation takes
    # effect quickly without revocation machinery, and long enough that the
    # phone is not refreshing constantly. The refresh token is what stops
    # anyone being asked for a password every morning.
    access_token_minutes: int = 30
    refresh_token_days: int = 30

    # How far back a phone may claim an offline punch was captured. A queued
    # punch carries the time it HAPPENED; anything older than this is refused
    # and stored with that reason, so a phone left in a drawer for a week
    # cannot backfill a month. Two days covers a weekend outage.
    max_queued_punch_hours: int = 48

    # Reject a punch from a phone that has not been bound to its employee.
    # See app/services/devices.py for what binding means and how HR clears one.
    require_device_binding: bool = True
    default_tz: str = "Asia/Kolkata"
    api_prefix: str = "/api/v1"

    # "stub" needs no AWS account. Switch to "rekognition" when there is one.
    face_provider: str = "stub"
    aws_region: str = "ap-south-1"

    # Declared, rather than left to boto3's own environment lookup, because
    # pydantic reads .env into THIS object and not into os.environ - so a key
    # pasted into apps/api/.env was invisible to boto3, which then silently
    # fell back to whatever ~/.aws/credentials happened to hold. "It works on
    # my machine, with the wrong account" is the failure that causes.
    #
    # Leave both unset in production and attach an IAM instance role instead:
    # app/core/aws.py falls through to boto3's default chain when they are
    # None, which is how the role gets picked up. See docs/AWS-CREDENTIALS.md.
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None

    # "null" writes the notification row - queryable, never lost - and does
    # not ring anyone's phone. There is no real device population to push to
    # yet; wire "expo" in once there is one worth the API calls.
    push_provider: str = "null"

    # Whether an employee with no reference photo can still punch.
    #
    # False during rollout: HR cannot enrol seven people before the app ships,
    # and locking everyone out on day one is a worse failure than a weak check.
    # Those punches are recorded with face_ok=NULL and a visible note - never
    # face_ok=True - so the gap is auditable rather than invisible.
    #
    # Flip to True once the enrolment screen shows 100%. That is the switch
    # that makes the face check actually load-bearing.
    require_face_enrolment: bool = False

    # Photos are files on disk for now, S3 later. Same interface either way.
    storage_dir: Path = DATA_DIR / "uploads"

    # Where nightly backups land. Local for now; S3 later, same as photos -
    # a copy on the same disk as the database survives a bad migration or a
    # careless DELETE, but not the disk dying. That is a real limitation and
    # it is why this points at a directory rather than pretending to be
    # disaster recovery.
    backup_dir: Path = DATA_DIR / "backups"
    backup_retention_days: int = 30

    # Retention. Biometric data is the one category where keeping it "just in
    # case" is a liability rather than a convenience, so both of these have an
    # expiry and a job that enforces it.
    #
    # A punch selfie proves who punched on a day someone disputes. Ninety days
    # covers three payroll cycles, which is longer than any dispute we expect
    # and short enough that a breach is not a photo album of the whole company.
    punch_selfie_retention_days: int = 90

    # The reference photo goes when the person leaves. Not the same day - HR
    # may still be closing out their final month - but not indefinitely either.
    reference_photo_days_after_exit: int = 30

    # Shared secret for the parked gate-reader ingest path. Empty means the
    # endpoint is closed: a reader that cannot authenticate must not be able to
    # file attendance for anyone.
    device_ingest_key: str = ""

    # --- the in-process scheduler (app/services/scheduler.py) ---
    # It lives inside the API process on purpose: attendance only happens while
    # the API is up, and a laptop-hosted prototype has no cron worth trusting.
    # Every job is idempotent (unique row per firing), so the interval is a
    # politeness setting, not a correctness one.
    scheduler_enabled: bool = True
    scheduler_interval_seconds: int = 60

    # "You haven't checked in" fires this long after shift start + grace.
    # Grace already forgives ordinary lateness; this is for the day someone
    # forgot entirely, so it should not fire while they are in the elevator.
    late_alert_after_minutes: int = 30

    # "You haven't punched out" fires this long after shift end, and goes
    # stale after the expiry: a nudge about the day before yesterday is noise,
    # and by then the board already shows the day flagged for correction.
    punch_out_nudge_after_minutes: int = 30
    punch_out_nudge_expiry_hours: int = 12

    default_geofence_radius_m: int = 200


settings = Settings()
