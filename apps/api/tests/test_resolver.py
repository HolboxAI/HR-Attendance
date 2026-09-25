"""Run: python3 tests/test_resolver.py  (no pytest needed)"""
import sys, os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.resolver import Punch, ShiftPolicy, resolve_day, shift_date_for

IST = ZoneInfo("Asia/Kolkata")
DAY = ShiftPolicy(start_time=time(9, 0), end_time=time(18, 0))
NIGHT = ShiftPolicy(start_time=time(22, 0), end_time=time(6, 0), cutover_hour=5)


def ist(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=IST).astimezone(ZoneInfo("UTC"))


def check(label, got, want):
    status = "PASS" if got == want else "FAIL"
    print(f"  [{status}] {label}: got {got!r}, want {want!r}")
    return got == want


ok = True
print("1. Normal day, 4 punches, lunch break")
r = resolve_day([
    Punch(ist(2026, 8, 24, 9, 5)),
    Punch(ist(2026, 8, 24, 13, 0)),
    Punch(ist(2026, 8, 24, 13, 45)),
    Punch(ist(2026, 8, 24, 18, 10)),
], DAY, date(2026, 8, 24))
ok &= check("status", r.status, "present")
ok &= check("worked_minutes", r.worked_minutes, 500)
ok &= check("break_minutes", r.break_minutes, 45)
ok &= check("late_minutes (5m late, 10m grace)", r.late_minutes, 0)
ok &= check("overtime_minutes", r.overtime_minutes, 10)
ok &= check("has_exception", r.has_exception, False)

print("2. Late arrival beyond grace")
r = resolve_day([Punch(ist(2026, 8, 24, 9, 47)), Punch(ist(2026, 8, 24, 18, 0))],
                DAY, date(2026, 8, 24))
ok &= check("late_minutes", r.late_minutes, 37)
ok &= check("status", r.status, "present")

print("3. Night shift 22:00-06:00 crosses midnight -> ONE shift date")
ok &= check("22:10 Aug10 belongs to", shift_date_for(ist(2026, 8, 10, 22, 10), NIGHT), date(2026, 8, 10))
ok &= check("01:30 Aug11 belongs to", shift_date_for(ist(2026, 8, 11, 1, 30), NIGHT), date(2026, 8, 10))
# The shift ENDS at 06:00, so the punch-out that closes it must file against
# the night that started yesterday - not the new calendar day.
ok &= check("06:05 Aug11 belongs to", shift_date_for(ist(2026, 8, 11, 6, 5), NIGHT), date(2026, 8, 10))
ok &= check("11:00 Aug11 belongs to", shift_date_for(ist(2026, 8, 11, 11, 0), NIGHT), date(2026, 8, 11))
ok &= check("derived cutover (end 06:00 + 3)", NIGHT.effective_cutover_hour, 9)

print("3b. A cutover configured BELOW the shift end is a mistake - self-heal it")
BAD = ShiftPolicy(start_time=time(22, 0), end_time=time(6, 0), cutover_hour=2)
ok &= check("corrected upward", BAD.effective_cutover_hour, 9)
ok &= check("punch-out still lands on the right night",
            shift_date_for(ist(2026, 8, 11, 6, 5), BAD), date(2026, 8, 10))
ok &= check("day shift cutover untouched", DAY.effective_cutover_hour, DAY.cutover_hour)
r = resolve_day([Punch(ist(2026, 8, 10, 22, 5)), Punch(ist(2026, 8, 11, 6, 2))],
                NIGHT, date(2026, 8, 10))
ok &= check("worked_minutes", r.worked_minutes, 477)
ok &= check("status", r.status, "present")
ok &= check("overtime_minutes", r.overtime_minutes, 2)

print("4. Forgot to punch out -> exception, not silently absent")
r = resolve_day([Punch(ist(2026, 8, 24, 9, 0))], DAY, date(2026, 8, 24))
ok &= check("has_exception", r.has_exception, True)
ok &= check("status", r.status, "not_marked")

print("5. No punches on a Sunday -> weekly off, not absent")
r = resolve_day([], DAY, date(2026, 8, 23))  # 2026-08-23 is a Sunday
ok &= check("weekday", date(2026, 8, 23).weekday(), 6)
ok &= check("status", r.status, "weekly_off")

print("6. No punches on a working day -> absent")
r = resolve_day([], DAY, date(2026, 8, 24))
ok &= check("status", r.status, "absent")

print("7. Half day (left after 4h)")
r = resolve_day([Punch(ist(2026, 8, 24, 9, 0)), Punch(ist(2026, 8, 24, 14, 0))],
                DAY, date(2026, 8, 24))
ok &= check("worked_minutes", r.worked_minutes, 300)
ok &= check("status", r.status, "half_day")
ok &= check("early_out_minutes", r.early_out_minutes, 240)

print("8. Device replays a duplicate-ish odd punch count -> still resolves")
r = resolve_day([
    Punch(ist(2026, 8, 24, 9, 0)),
    Punch(ist(2026, 8, 24, 13, 0)),
    Punch(ist(2026, 8, 24, 14, 0)),
], DAY, date(2026, 8, 24))
ok &= check("has_exception", r.has_exception, True)
ok &= check("worked_minutes", r.worked_minutes, 240)

print("9. Multi-punch day: bathroom break (5m) + tea break (30m)")
SHIFT_LONG = ShiftPolicy(start_time=time(9, 30), end_time=time(20, 0))
r9 = resolve_day([
    Punch(ist(2026, 8, 24, 9, 30), direction="in"),
    Punch(ist(2026, 8, 24, 11, 0), direction="out"),
    Punch(ist(2026, 8, 24, 11, 5), direction="in"),
    Punch(ist(2026, 8, 24, 17, 30), direction="out"),
    Punch(ist(2026, 8, 24, 18, 0), direction="in"),
    Punch(ist(2026, 8, 24, 20, 0), direction="out"),
], SHIFT_LONG, date(2026, 8, 24))
ok &= check("worked_minutes (9h 55m)", r9.worked_minutes, 595)
ok &= check("break_minutes (35m)", r9.break_minutes, 35)
ok &= check("punch_count", r9.punch_count, 6)
ok &= check("status", r9.status, "present")

print("10. Live ongoing work hours at 14:00 (as_of during shift)")
r10 = resolve_day([
    Punch(ist(2026, 8, 24, 9, 30), direction="in"),
    Punch(ist(2026, 8, 24, 11, 0), direction="out"),
    Punch(ist(2026, 8, 24, 11, 5), direction="in"),
], SHIFT_LONG, date(2026, 8, 24), as_of=ist(2026, 8, 24, 14, 0))
ok &= check("live worked_minutes at 14:00 (4h 25m)", r10.worked_minutes, 265)
ok &= check("live break_minutes (5m)", r10.break_minutes, 5)
ok &= check("is_currently_in", r10.is_currently_in, True)
ok &= check("current_session_minutes (11:05 to 14:00 = 175m)", r10.current_session_minutes, 175)

print()
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
