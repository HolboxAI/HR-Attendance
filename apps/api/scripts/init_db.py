"""Create the SQLite file and every table. Safe to re-run."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import DATA_DIR, settings   # noqa: E402
from app.db.base import Base                      # noqa: E402
from app.db.session import engine                 # noqa: E402
import app.models                                 # noqa: F401,E402

DATA_DIR.mkdir(parents=True, exist_ok=True)
Base.metadata.create_all(engine)

print(f"database  : {settings.database_url}")
print(f"tables    : {len(Base.metadata.tables)}")
for name in sorted(Base.metadata.tables):
    print(f"  - {name}")
