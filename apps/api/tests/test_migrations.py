"""Run: python3 tests/test_migrations.py

Migrations are the only thing standing between "add a column" and "lose the
pilot's attendance". Three things have to hold:

  1. A migrated database matches the models exactly.
  2. Migrations are reversible.
  3. A database built before migrations existed can be adopted without a
     rebuild - the pilot's punches cannot be thrown away to gain a version
     table.

Uses throwaway SQLite files; never touches data/boxcode.db.
"""
import os
import subprocess
import sys
import sqlite3
import tempfile
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

TMP = Path(tempfile.mkdtemp(prefix="boxcode-migrations-"))
PY_BIN = sys.executable

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


def alembic(db: Path, *args: str):
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db}"}
    return subprocess.run(
        [PY_BIN, "-m", "alembic", *args],
        cwd=API_DIR, env=env, capture_output=True, text=True,
    )


def tables(db: Path) -> set[str]:
    if not db.exists():
        return set()
    c = sqlite3.connect(db)
    try:
        return {
            r[0] for r in c.execute("select name from sqlite_master where type='table'")
        } - {"sqlite_sequence"}
    finally:
        c.close()


def columns(db: Path) -> dict:
    c = sqlite3.connect(db)
    try:
        out = {}
        for t in sorted(tables(db) - {"alembic_version"}):
            out[t] = {
                (r[1], r[2].upper(), bool(r[3]))
                for r in c.execute(f"pragma table_info('{t}')")
            }
        return out
    finally:
        c.close()


def build_with_models(db: Path) -> None:
    """The old create_all path, i.e. what a pre-migration database looks like."""
    subprocess.run(
        [PY_BIN, "-c",
         "import app.models; from app.db.base import Base; "
         "from app.db.session import engine; Base.metadata.create_all(engine)"],
        cwd=API_DIR, env={**os.environ, "DATABASE_URL": f"sqlite:///{db}"},
        capture_output=True, text=True, check=True,
    )


print("1. A migrated database matches the models exactly")
migrated = TMP / "migrated.db"
r = alembic(migrated, "upgrade", "head")
check("upgrade succeeds", r.returncode, 0)
check("has the version marker", "alembic_version" in tables(migrated), True)
r = alembic(migrated, "check")
check("alembic sees no drift from the models",
      "No new upgrade operations detected" in (r.stdout + r.stderr), True)

from_models = TMP / "models.db"
build_with_models(from_models)
# Compared as booleans: a mismatch is reported below in full, but a PASS
# should not dump 21 tables of schema into the output.
same_tables = tables(migrated) - {"alembic_version"} == tables(from_models)
check("same tables as create_all", same_tables, True)
if not same_tables:
    print("     migrated only:", sorted(tables(migrated) - {"alembic_version"} - tables(from_models)))
    print("     models only  :", sorted(tables(from_models) - tables(migrated)))

mig_cols, model_cols = columns(migrated), columns(from_models)
check("same columns, types and nullability", mig_cols == model_cols, True)
for t in sorted(set(mig_cols) & set(model_cols)):
    if mig_cols[t] != model_cols[t]:
        print(f"     {t}: migrated-only {sorted(mig_cols[t] - model_cols[t])}, "
              f"models-only {sorted(model_cols[t] - mig_cols[t])}")
# Derived from the models, not hardcoded - a count in a test is a thing
# that goes stale the first time someone adds a table.
from app.db.base import Base
import app.models  # noqa: F401
check("every model table is present", len(tables(from_models)), len(Base.metadata.tables))


print("2. Migrations are reversible")
r = alembic(migrated, "downgrade", "base")
check("downgrade succeeds", r.returncode, 0)
check("everything dropped but the marker", tables(migrated), {"alembic_version"})
r = alembic(migrated, "upgrade", "head")
check("and it comes back", r.returncode, 0)
check("schema identical after a round trip", columns(migrated) == columns(from_models), True)


print("3. A pre-migration database is adopted, not rebuilt")
legacy = TMP / "legacy.db"
build_with_models(legacy)
c = sqlite3.connect(legacy)
c.execute("insert into organizations (id, name, timezone, country, settings, "
          "created_at, updated_at) values ('org-1','Boxcode','Asia/Kolkata','IN','{}',"
          "'2026-01-01','2026-01-01')")
c.commit()
c.close()
check("starts with no version marker", "alembic_version" in tables(legacy), False)

r = subprocess.run(
    [PY_BIN, "scripts/init_db.py"], cwd=API_DIR,
    env={**os.environ, "DATABASE_URL": f"sqlite:///{legacy}"},
    capture_output=True, text=True,
)
check("init_db succeeds on it", r.returncode, 0)
check("it says what it did", "predates migrations" in r.stdout, True)
check("marker now present", "alembic_version" in tables(legacy), True)

c = sqlite3.connect(legacy)
rows = [row[0] for row in c.execute("select count(*) from organizations")]
revision = [row[0] for row in c.execute("select version_num from alembic_version")]
c.close()
check("THE DATA SURVIVED", rows[0], 1)
check("stamped at the baseline, not left empty", len(revision), 1)
r = alembic(legacy, "check")
check("and alembic agrees it is current",
      "No new upgrade operations detected" in (r.stdout + r.stderr), True)


print("4. Running init_db twice is a no-op")
r = subprocess.run(
    [PY_BIN, "scripts/init_db.py"], cwd=API_DIR,
    env={**os.environ, "DATABASE_URL": f"sqlite:///{legacy}"},
    capture_output=True, text=True,
)
check("still succeeds", r.returncode, 0)
check("does not re-stamp", "predates migrations" in r.stdout, False)

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
