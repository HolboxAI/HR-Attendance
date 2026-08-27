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

    default_geofence_radius_m: int = 200


settings = Settings()
