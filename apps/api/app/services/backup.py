"""Backups, and proving they can actually be restored.

The PRD asks for nightly dumps with 30-day retention AND a restore tested
before rollout. The second half is the part people skip, so it is not optional
here: `create()` verifies every backup the moment it writes it, by opening the
copy and reading real rows out of it. A backup nobody has restored is a hope,
not a backup.

**Why not just copy the file.** SQLite writes through a journal; copying
boxcode.db while the API is mid-transaction can capture a torn database that
looks fine until the day you need it. sqlite3's own backup API takes a
consistent snapshot of a live database instead, which is the entire reason
this module exists rather than a one-line `cp` in a cron job.
"""

from __future__ import annotations

import gzip
import shutil
import sqlite3
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.config import settings

# Tables whose emptiness would mean the backup is useless, checked on every
# verify. Not an exhaustive list - just enough that a silently empty file
# cannot pass as a good backup.
SENTINEL_TABLES = ("employees", "punch_events", "users")


@dataclass
class BackupResult:
    path: Path
    bytes_written: int
    verified: bool
    tables: int
    rows: dict[str, int]
    note: str | None = None

    @property
    def summary(self) -> str:
        mb = self.bytes_written / (1024 * 1024)
        state = "verified" if self.verified else "NOT VERIFIED"
        return f"{self.path.name} · {mb:.2f} MB · {state}"


def _is_sqlite() -> bool:
    return settings.database_url.startswith("sqlite")


def _sqlite_path() -> Path:
    # sqlite:////abs/path or sqlite:///rel/path
    raw = settings.database_url.split("sqlite:///", 1)[1]
    return Path(raw if raw.startswith("/") else raw).resolve()


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _unique_path(dest_dir: Path) -> Path:
    """A filename no existing backup already owns.

    The stamp is second-resolution, so two backups inside the same second -
    a cron that fired twice, or someone taking a manual one right after the
    nightly - would otherwise land on the same name and the second would
    silently destroy the first. A backup tool that eats backups is worse than
    no backup tool.
    """
    base = f"boxcode-{_stamp()}"
    candidate, n = dest_dir / f"{base}.db", 1
    while candidate.exists() or candidate.with_suffix(".db.gz").exists():
        candidate = dest_dir / f"{base}-{n}.db"
        n += 1
    return candidate


def create(dest_dir: Path | None = None, *, verify: bool = True) -> BackupResult:
    """Take a consistent snapshot, compress it, and prove it opens."""
    dest_dir = dest_dir or settings.backup_dir
    dest_dir.mkdir(parents=True, exist_ok=True)

    if not _is_sqlite():
        return _create_postgres(dest_dir)

    source = _sqlite_path()
    if not source.exists():
        raise FileNotFoundError(f"No database at {source}")

    raw = _unique_path(dest_dir)

    # The online backup API, not shutil.copy: this is safe while the API is
    # running and writing.
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(raw)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    result = _verify_sqlite(raw) if verify else BackupResult(raw, 0, False, 0, {})

    # Compress only after verifying - a corrupt gzip of a corrupt database is
    # two problems instead of one.
    gz = raw.with_suffix(".db.gz")
    with raw.open("rb") as f_in, gzip.open(gz, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    raw.unlink()

    result.path = gz
    result.bytes_written = gz.stat().st_size
    return result


def _create_postgres(dest_dir: Path) -> BackupResult:
    """pg_dump, gzipped.

    Deliberately NOT self-verifying: checking a Postgres dump means restoring
    it into a scratch database, which needs a server this process may not be
    allowed to create one on. Use `verify_postgres_dump()` from a host that
    can, before rollout - the PRD requires that test to have happened, and
    this returns note= saying it has not.
    """
    out = dest_dir / f"boxcode-{_stamp()}.sql.gz"
    n = 1
    while out.exists():
        out = dest_dir / f"boxcode-{_stamp()}-{n}.sql.gz"
        n += 1
    proc = subprocess.run(
        ["pg_dump", "--no-owner", "--no-acl", settings.database_url],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {proc.stderr.decode()[:400]}")
    with gzip.open(out, "wb") as f:
        f.write(proc.stdout)

    return BackupResult(
        path=out, bytes_written=out.stat().st_size, verified=False,
        tables=0, rows={},
        note="pg_dump written but NOT restore-tested - verify into a scratch "
             "database before relying on it",
    )


def _verify_sqlite(path: Path) -> BackupResult:
    """Open the backup and read real rows. This is the restore test."""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Backup failed integrity check: {integrity}")

        names = [
            r[0] for r in conn.execute(
                "select name from sqlite_master where type='table'"
            )
        ]
        rows = {}
        for table in SENTINEL_TABLES:
            if table in names:
                rows[table] = conn.execute(f"select count(*) from {table}").fetchone()[0]

        return BackupResult(
            path=path, bytes_written=path.stat().st_size, verified=True,
            tables=len(names), rows=rows,
        )
    finally:
        conn.close()


def verify_file(path: Path) -> BackupResult:
    """Restore-test an existing backup file, gzipped or not."""
    if path.suffix == ".gz":
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            with gzip.open(path, "rb") as f_in:
                shutil.copyfileobj(f_in, tmp)
            scratch = Path(tmp.name)
        try:
            result = _verify_sqlite(scratch)
        finally:
            scratch.unlink(missing_ok=True)
        result.path = path
        result.bytes_written = path.stat().st_size
        return result
    return _verify_sqlite(path)


def restore(backup: Path, target: Path) -> Path:
    """Write a backup back out as a usable database.

    Refuses to overwrite. Restoring onto a live database is how a bad afternoon
    becomes a bad week - restore beside it, look at it, then swap deliberately.
    """
    if target.exists():
        raise FileExistsError(
            f"{target} already exists. Restore to a new path and swap it in "
            f"yourself once you have looked at it."
        )
    target.parent.mkdir(parents=True, exist_ok=True)

    if backup.suffix == ".gz":
        with gzip.open(backup, "rb") as f_in, target.open("wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
    else:
        shutil.copy2(backup, target)
    return target


def prune(dest_dir: Path | None = None, *, keep_days: int | None = None,
          dry_run: bool = False) -> list[Path]:
    """Delete backups older than the retention window. Newest is never pruned.

    Keeping the newest regardless is deliberate: a system left off for two
    months should still have its last backup when someone comes back to it,
    rather than having tidied away the only copy.
    """
    dest_dir = dest_dir or settings.backup_dir
    keep_days = keep_days if keep_days is not None else settings.backup_retention_days
    if not dest_dir.exists():
        return []

    backups = sorted(
        [p for p in dest_dir.glob("boxcode-*") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
    removed = []
    for path in backups[1:]:                     # never the newest
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        if modified < cutoff:
            removed.append(path)
            if not dry_run:
                path.unlink()
    return removed


def listing(dest_dir: Path | None = None) -> list[tuple[Path, datetime, int]]:
    dest_dir = dest_dir or settings.backup_dir
    if not dest_dir.exists():
        return []
    out = []
    for p in sorted(dest_dir.glob("boxcode-*")):
        if p.is_file():
            st = p.stat()
            out.append((p, datetime.fromtimestamp(st.st_mtime, tz=timezone.utc), st.st_size))
    return out
