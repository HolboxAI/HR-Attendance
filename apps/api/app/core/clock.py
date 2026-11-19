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

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import settings


def org_now() -> datetime:
    return datetime.now(ZoneInfo(settings.default_tz))


def org_today() -> date:
    """Current active shift date in the org's timezone (Asia/Kolkata).
    
    The operational day resets at 05:30 AM IST (00:00 UTC).
    Punches and shifts between 00:00 and 05:30 IST belong to the previous day's shift,
    so org_today() rolls over at 05:30 AM IST to match the shift cutover.
    """
    now = org_now()
    if (now.hour, now.minute) < (5, 30):
        return (now - timedelta(days=1)).date()
    return now.date()
