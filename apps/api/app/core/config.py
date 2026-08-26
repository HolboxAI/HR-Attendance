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

    default_geofence_radius_m: int = 200


settings = Settings()
