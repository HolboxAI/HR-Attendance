"""Attendance resolver.

A PURE function: (punches, shift policy) -> one resolved day.

It touches no database and no clock. That is deliberate - it means we can
recompute any day, for any employee, at any time, and always get the same
answer. When a device replays a week of buffered punches, we just re-run this.

All datetimes in and out are timezone-aware UTC.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Punch:
    ts_utc: datetime
    direction: str = "unknown"   # "in" | "out" | "unknown"
    source: str = "gate_device"


@dataclass(frozen=True)
class ShiftPolicy:
    start_time: time
    end_time: time
    break_minutes: int = 60
    grace_minutes: int = 10
    half_day_after_minutes: int = 240
    full_day_after_minutes: int = 450
    cutover_hour: int = 5
    working_days: tuple[int, ...] = (0, 1, 2, 3, 4, 5)   # Mon=0 .. Sun=6
    tz: str = "Asia/Kolkata"

    @property
    def is_overnight(self) -> bool:
        return self.end_time <= self.start_time


@dataclass
class ResolvedDay:
    shift_date: date
    first_in: datetime | None = None
    last_out: datetime | None = None
    worked_minutes: int = 0
    break_minutes: int = 0
    late_minutes: int = 0
    early_out_minutes: int = 0
    overtime_minutes: int = 0
    status: str = "not_marked"
    punch_count: int = 0
    has_exception: bool = False
    exception_note: str | None = None
    pairs: list[tuple[datetime, datetime | None]] = field(default_factory=list)


def shift_date_for(ts_utc: datetime, policy: ShiftPolicy) -> date:
    """Which shift-date does this punch belong to?

    A 01:30 punch on a 22:00-06:00 shift belongs to YESTERDAY. Calendar date
    is the wrong key for anything but a plain day shift.
    """
    local = ts_utc.astimezone(ZoneInfo(policy.tz))
    if policy.is_overnight and local.hour < policy.cutover_hour:
        return (local - timedelta(days=1)).date()
    return local.date()


def _infer_directions(punches: list[Punch]) -> list[tuple[Punch, str]]:
    """Cheap readers report no direction. Alternate in/out by order.

    Any punch that DOES carry a direction is trusted and resets the alternation,
    so a mixed fleet (one smart reader, one dumb one) still resolves correctly.
    """
    out: list[tuple[Punch, str]] = []
    expect_in = True
    for p in punches:
        if p.direction in ("in", "out"):
            resolved = p.direction
            expect_in = resolved == "out"
        else:
            resolved = "in" if expect_in else "out"
            expect_in = not expect_in
        out.append((p, resolved))
    return out


def resolve_day(
    punches: list[Punch],
    policy: ShiftPolicy,
    shift_date: date,
    *,
    is_holiday: bool = False,
    is_on_leave: bool = False,
) -> ResolvedDay:
    day = ResolvedDay(shift_date=shift_date)
    tz = ZoneInfo(policy.tz)

    punches = sorted(punches, key=lambda p: p.ts_utc)
    day.punch_count = len(punches)

    if not punches:
        if is_on_leave:
            day.status = "on_leave"
        elif is_holiday:
            day.status = "holiday"
        elif shift_date.weekday() not in policy.working_days:
            day.status = "weekly_off"
        else:
            day.status = "absent"
        return day

    directed = _infer_directions(punches)
    day.first_in = next((p.ts_utc for p, d in directed if d == "in"), punches[0].ts_utc)
    day.last_out = next((p.ts_utc for p, d in reversed(directed) if d == "out"), None)

    # Pair up in->out. An unmatched trailing "in" means someone never punched out.
    open_in: datetime | None = None
    worked = timedelta()
    gaps: list[timedelta] = []
    last_out: datetime | None = None

    for p, d in directed:
        if d == "in":
            if open_in is None:
                open_in = p.ts_utc
                if last_out is not None:
                    gaps.append(p.ts_utc - last_out)
        else:
            if open_in is not None:
                worked += p.ts_utc - open_in
                day.pairs.append((open_in, p.ts_utc))
                last_out = p.ts_utc
                open_in = None

    if open_in is not None:
        day.pairs.append((open_in, None))
        day.has_exception = True
        day.exception_note = "Missing punch-out - needs regularization"

    if len(punches) == 1:
        day.has_exception = True
        day.exception_note = "Only one punch recorded"

    day.worked_minutes = int(worked.total_seconds() // 60)
    day.break_minutes = int(sum(g.total_seconds() for g in gaps) // 60)

    # Late / early, measured against the scheduled shift in local time.
    scheduled_start = datetime.combine(shift_date, policy.start_time, tzinfo=tz)
    end_date = shift_date + timedelta(days=1) if policy.is_overnight else shift_date
    scheduled_end = datetime.combine(end_date, policy.end_time, tzinfo=tz)

    if day.first_in:
        late = (day.first_in.astimezone(tz) - scheduled_start).total_seconds() / 60
        day.late_minutes = max(0, int(late) - policy.grace_minutes)

    if day.last_out:
        early = (scheduled_end - day.last_out.astimezone(tz)).total_seconds() / 60
        day.early_out_minutes = max(0, int(early))
        over = (day.last_out.astimezone(tz) - scheduled_end).total_seconds() / 60
        day.overtime_minutes = max(0, int(over))

    if is_on_leave:
        day.status = "on_leave"
    elif day.worked_minutes >= policy.full_day_after_minutes:
        day.status = "present"
    elif day.worked_minutes >= policy.half_day_after_minutes:
        day.status = "half_day"
    elif day.has_exception:
        day.status = "not_marked"
    else:
        day.status = "absent"

    return day
