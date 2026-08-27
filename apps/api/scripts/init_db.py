"""Bring the database up to the current schema. Safe to re-run.

    python scripts/init_db.py

This runs Alembic migrations, not `create_all`. That matters: `create_all`
only ever CREATES tables that are missing, so once a database exists it
silently ignores every later change to the models. A column added tomorrow
would simply not be there, and the failure surfaces as a confusing error at
query time rather than at setup.

Running migrations in development too - not only in production - is the point.
It means the upgrade path is exercised daily by the people who can fix it,
instead of being tried for the first time against real attendance data.
"""
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

from app.core.config import DATA_DIR, settings   # noqa: E402

DATA_DIR.mkdir(parents=True, exist_ok=True)


def stamp_existing_database() -> bool:
    """Adopt a database that predates migrations.

    Any database built by the old `create_all` path has every table but no
    alembic_version row, so Alembic would try to create tables that already
    exist and fail. The schemas are verified identical (tests/test_migrations),
    so the honest move is to record it as already being at the baseline rather
    than make anyone rebuild and lose their punches.

    Only ever stamps when the tables are there and the marker is not. A fresh
    database falls through and migrates normally.
    """
    from sqlalchemy import inspect

    from app.db.session import engine

    tables = set(inspect(engine).get_table_names())
    if not tables or "alembic_version" in tables:
        return False

    print("Existing database predates migrations - recording it at the "
          "baseline revision. No tables are touched.")
    subprocess.run(
        [sys.executable, "-m", "alembic", "stamp", "base"],
        cwd=API_DIR, capture_output=True, text=True, check=True,
    )
    # `stamp base` writes the marker table; move it to the baseline revision so
    # the already-applied schema is not applied again.
    subprocess.run(
        [sys.executable, "-m", "alembic", "stamp", "head"],
        cwd=API_DIR, capture_output=True, text=True, check=True,
    )
    return True


stamp_existing_database()

result = subprocess.run(
    [sys.executable, "-m", "alembic", "upgrade", "head"],
    cwd=API_DIR,
    capture_output=True,
    text=True,
)

if result.returncode != 0:
    print(result.stdout)
    print(result.stderr, file=sys.stderr)
    print("\nMigration failed. The database has NOT been changed.", file=sys.stderr)
    sys.exit(result.returncode)

# Alembic logs the revisions it applied to stderr; echo only those.
for line in result.stderr.splitlines():
    if "Running upgrade" in line:
        print(line.split("INFO  [alembic.runtime.migration] ")[-1])

from app.db.base import Base       # noqa: E402
import app.models                  # noqa: F401,E402

print(f"database  : {settings.database_url}")
print(f"tables    : {len(Base.metadata.tables)} at the current revision")
