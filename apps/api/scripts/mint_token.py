"""Print a bearer token, so a curl one-liner does not need a login dance.

    python scripts/mint_token.py                     Krish (super_admin)
    python scripts/mint_token.py himesh@holbox.ai    somebody else
    export T=$(python scripts/mint_token.py)

NOT called token.py: the standard library has a `token` module, and
`tokenize` imports it with `from token import *`. A script of that name in
scripts/ shadows it and every import of sqlalchemy dies in a circular import
with no obvious connection to the file you just added.

Mints straight from the database rather than signing in, because nobody knows
every colleague's password and resetting one to run a check would be a silly
way to lock someone out. Same shortcut scripts/punch_as.py takes, and this is
a local operator tool - it needs database access, which is already strictly
more than the token it prints.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                      # noqa: E402

from app.core.security import create_token_pair    # noqa: E402
from app.db.session import SessionLocal            # noqa: E402
import app.models                                  # noqa: F401,E402
from app.models.employee import User               # noqa: E402

email = sys.argv[1].lower() if len(sys.argv) > 1 else "krish@boxcode.ai"
db = SessionLocal()
user = db.scalar(select(User).where(User.email == email))
if user is None:
    emails = [u.email for u in db.scalars(select(User).order_by(User.email)).all()]
    sys.exit(f"No account for {email}.\nTry: " + "\n     ".join(emails))
print(create_token_pair(user_id=user.id, role=user.role.value,
                        employee_id=user.employee_id).access_token)
