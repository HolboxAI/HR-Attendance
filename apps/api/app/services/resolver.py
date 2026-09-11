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

    @property
    def effective_cutover_hour(self) -> int:
        """The hour before which a punch belongs to YESTERDAY's shift.

        This must sit AFTER the shift ends, or the punch-out that closes the
        night is filed against the next day and both days resolve wrong - the
        night shows "never left" and the morning shows a stray punch.

        A configured value below the shift end is always a mistake, so we
        correct it rather than silently losing punch-outs. Three hours of slack
        covers overtime and someone finishing late.
        """
        if not self.is_overnight:
            return self.cutover_hour
        floor = min(self.end_time.hour + 3, 23)
        return max(self.cutover_hour, floor)


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
    if policy.is_overnight and local.hour < policy.effective_cutover_hour:
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
    leave_fraction: float | None = None,
    as_of: datetime | None = None,
) -> ResolvedDay:
    """`as_of` is passed in rather than read from the clock, so this stays pure.

    Without it, a day whose shift has not finished yet resolves to "absent" -
    so at 10am the whole company looks absent, and every future date in a month
    view is a wall of red. Nobody is absent until their shift has ended.

    `leave_fraction` is 0.5 for a half day and 1.0 for a whole one;
    `is_on_leave` is the boolean shorthand for a whole day. Half a day of leave
    plus half a day worked is a FULL day, not an absence - getting that wrong
    docks people for a day they were partly at work.
    """
    day = ResolvedDay(shift_date=shift_date)
    if leave_fraction is None:
        leave_fraction = 1.0 if is_on_leave else 0.0
    on_leave = leave_fraction > 0
    tz = ZoneInfo(policy.tz)
    shift_over = _shift_has_ended(policy, shift_date, as_of)

    punches = sorted(punches, key=lambda p: p.ts_utc)
    day.punch_count = len(punches)

    if not punches:
        if leave_fraction >= 1.0:
            day.status = "on_leave"
        elif on_leave:
            # Half day booked, nothing worked. Still a half day of leave, not a
            # whole day of absence.
            day.status = "half_day"
        elif is_holiday:
            day.status = "holiday"
        elif shift_date.weekday() not in policy.working_days:
            day.status = "weekly_off"
        elif shift_over:
            day.status = "absent"
        else:
            day.status = "not_marked"      # today, or the future - not absent
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
        if shift_over:
            day.has_exception = True
            day.exception_note = "Missing punch-out - needs regularization"

    if len(punches) == 1 and shift_over:
        day.has_exception = True
        day.exception_note = "Only one punch recorded"

    day.worked_minutes = int(worked.total_seconds() // 60)
    day.break_minutes = int(sum(g.total_seconds() for g in gaps) // 60)

    # Late / early, measured against the scheduled shift in local time.
    scheduled_start, scheduled_end = shift_bounds(policy, shift_date)

    if day.first_in:
        late = (day.first_in.astimezone(tz) - scheduled_start).total_seconds() / 60
        day.late_minutes = max(0, int(late) - policy.grace_minutes)

    if day.last_out and open_in is None:
        early = (scheduled_end - day.last_out.astimezone(tz)).total_seconds() / 60
        day.early_out_minutes = max(0, int(early))
        over = (day.last_out.astimezone(tz) - scheduled_end).total_seconds() / 60
        day.overtime_minutes = max(0, int(over))

    if leave_fraction >= 1.0:
        day.status = "on_leave"
        # They were on approved leave and came in anyway. Both facts are true.
        # Do not swallow the punch and do not cancel the leave - surface it and
        # let a human decide which one was the mistake.
        day.has_exception = True
        day.exception_note = "Worked on an approved leave day - HR to confirm"
    elif on_leave and day.worked_minutes >= policy.half_day_after_minutes:
        # Half leave + half worked = a full day.
        day.status = "present"
    elif on_leave:
        day.status = "half_day"
    elif day.worked_minutes >= policy.full_day_after_minutes:
        day.status = "present"
    elif day.worked_minutes >= policy.half_day_after_minutes:
        day.status = "half_day"
    elif day.has_exception or not shift_over:
        # Someone who punched in an hour ago is at work, not absent.
        day.status = "not_marked"
    else:
        day.status = "absent"
        if day.punch_count > 0:
            # They showed up and it still did not count. That sentence must
            # finish itself: an unexplained "absent" beside a visible check-in
            # reads as the system losing a punch, and the first place anyone
            # looks is the pipeline rather than the threshold.
            worked_h, worked_m = divmod(day.worked_minutes, 60)
            need_h, need_m = divmod(policy.half_day_after_minutes, 60)
            day.exception_note = (
                f"Punched, but worked {worked_h}h{worked_m:02d} - "
                f"a half day needs at least {need_h}h{need_m:02d}"
            )

    return day


def shift_bounds(policy: ShiftPolicy, shift_date: date) -> tuple[datetime, datetime]:
    """Scheduled start and end of this shift-date, as aware local datetimes.

    The overnight adjustment lives HERE and nowhere else. Three call sites
    (late minutes, "has the shift ended", the scheduler's alerts) each doing
    their own end-date arithmetic is exactly the shape of the cutover bug.
    """
    tz = ZoneInfo(policy.tz)
    start = datetime.combine(shift_date, policy.start_time, tzinfo=tz)
    end_date = shift_date + timedelta(days=1) if policy.is_overnight else shift_date
    end = datetime.combine(end_date, policy.end_time, tzinfo=tz)
    return start, end


def _shift_has_ended(policy: ShiftPolicy, shift_date: date, as_of: datetime | None) -> bool:
    if as_of is None:
        return True                      # no clock supplied: judge the day whole
    _, scheduled_end = shift_bounds(policy, shift_date)
    return as_of.astimezone(ZoneInfo(policy.tz)) >= scheduled_end
