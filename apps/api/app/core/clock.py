"""What day is it - in the org's timezone, which is the only one that counts.

datetime.now(timezone.utc).date() answers "what day is it in London". Boxcode
runs on IST, which is 5h30 ahead, so between midnight and 05:30 IST that
answer is YESTERDAY. The board asked exactly that question for its default
date, so a punch at 02:43 filed to today while the board silently showed
yesterday - accepted in the terminal, invisible on the screen.

This is the trap CLAUDE.md already names ("format times in the ORG's
timezone, never the server's") applied to date arithmetic, where it is worse:
a mis-rendered time looks wrong, a mis-chosen date looks like missing data.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.core.config import settings


def org_now() -> datetime:
    return datetime.now(ZoneInfo(settings.default_tz))


def org_today() -> date:
    return org_now().date()
