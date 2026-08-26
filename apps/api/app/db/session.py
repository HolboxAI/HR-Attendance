from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
    # SQLite + FastAPI: the request thread isn't the thread that opened it.
    connect_args={"check_same_thread": False} if is_sqlite else {},
)

if is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover
        cur = dbapi_conn.cursor()
        # SQLite enforces foreign keys only if you ask it to. We have plenty.
        cur.execute("PRAGMA foreign_keys=ON")
        # Journal mode, in order of preference.
        #
        # The default (DELETE) removes the rollback journal on every commit,
        # and some mounted or synced filesystems refuse that delete - which
        # surfaces as a baffling "disk I/O error" rather than a permissions
        # message. PERSIST zeroes the journal header instead of deleting it;
        # MEMORY skips the journal file entirely, which is fastest and works
        # anywhere, at the cost of crash-safety mid-transaction.
        #
        # For a prototype on a laptop that trade is fine. It disappears the
        # moment we move to Postgres.
        for mode in ("PERSIST", "MEMORY"):
            try:
                cur.execute(f"PRAGMA journal_mode={mode}")
                break
            except Exception:       # noqa: BLE001 - filesystem, not logic
                continue
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
