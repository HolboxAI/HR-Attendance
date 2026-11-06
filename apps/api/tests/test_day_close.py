"""Run: python3 tests/test_day_close.py

11:59 PM is still today. 12:00 AM is the next day, so the one mail must not
wait for midnight. A date before today is not rewritten when someone updates
the month.
"""
import os
import sys
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.email_templates import shift_summary_html  # noqa: E402
from app.services.slack import classify_punch_alert  # noqa: E402
from app.services.planned_absence import dates_to_apply, horizon_end  # noqa: E402
from app.services.resolver import Punch, ShiftPolicy, resolve_day  # noqa: E402
from app.services.scheduler import (  # noqa: E402
    format_break_windows,
    in_day_close_window,
    punctuality_label,
    remarks_for,
    _extra_fields,
)

ok = True
tz = ZoneInfo("Asia/Kolkata")


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


print("1. The close is the last minute of the same day")
check("11:58", in_day_close_window(datetime(2026, 10, 6, 23, 58, tzinfo=tz)), False)
check("11:59", in_day_close_window(datetime(2026, 10, 6, 23, 59, tzinfo=tz)), True)
check("11:59:40", in_day_close_window(datetime(2026, 10, 6, 23, 59, 40, tzinfo=tz)), True)

print("2. Extra hours are time past the shift end")
check("none", _extra_fields(type("D", (), {"overtime_minutes": 0})()).get("extra_str"), "—")
check("90m", _extra_fields(type("D", (), {"overtime_minutes": 90})()).get("extra_str"), "1h 30m")

print("3. Past dates in the month cannot be added or removed from here")
today = date(2026, 10, 7)
wanted = {date(2026, 10, 6), date(2026, 10, 14), date(2026, 11, 2)}
check("kept", dates_to_apply(wanted, year=2026, month=10, today=today), {date(2026, 10, 14)})

print("4. The nightly list reaches the end of next month")
check("horizon", horizon_end(date(2026, 10, 7)), date(2026, 11, 30))

print("5. Punctuality is arrival, and a rename shows as its own column")
check("on time", punctuality_label(status="present", late_minutes=0, regularized=False, checked_in=True), "On time")
check("late", punctuality_label(status="absent", late_minutes=12, regularized=False, checked_in=True), "Late")
check("away", punctuality_label(status="absent", late_minutes=0, regularized=False, checked_in=False), "Absent")
check("fixed", punctuality_label(status="present", late_minutes=25, regularized=True, checked_in=True), "Regularised")
check("quiet", remarks_for(status="present", exception_note=None, punctuality="On time"), "On time.")
check("kept note", remarks_for(status="absent", exception_note="Missing punch-out - needs regularization", punctuality="Late"), "Missing punch-out - needs regularization")


def ist(hour, minute):
    return datetime(2026, 10, 7, hour, minute, tzinfo=tz).astimezone(timezone.utc)


policy = ShiftPolicy(start_time=time(13, 0), end_time=time(21, 0), grace_minutes=10, tz="Asia/Kolkata")
resolved = resolve_day(
    [
        Punch(ist(13, 0), "in"),
        Punch(ist(14, 0), "out"),
        Punch(ist(14, 20), "in"),
        Punch(ist(21, 0), "out"),
    ],
    policy,
    date(2026, 10, 7),
    as_of=ist(23, 59),
)
check("one break", len(resolved.break_spans), 1)
check("break minutes", resolved.break_minutes, 20)
check("break window", format_break_windows(resolved.break_spans, tz), "2:00 PM–2:20 PM")

html = shift_summary_html(
    shift_name="Operations",
    shift_timing="1:00 PM – 9:00 PM",
    shift_date_label="Wednesday, October 07, 2026",
    stats={"total": 1, "present": 1, "late": 0, "absent": 0, "leave": 0},
    roster=[{
        "date_label": "2026-10-07",
        "code": "BX099",
        "name": "Vishnu Nair",
        "department": "Engineering",
        "shift_allotted": "1:00 PM – 9:00 PM",
        "status": "present",
        "first_in": "1:00 PM",
        "last_out": "9:00 PM",
        "late_minutes": 0,
        "late_str": "On Time",
        "break_windows": "2:00 PM–2:20 PM",
        "break_str": "20m",
        "hours_str": "7h 40m",
        "extra_str": "—",
        "punctuality": "On time",
        "regularised_by": "N/A",
        "leave_status": "N/A",
        "leave_approved_by": "N/A",
        "remarks": "On time.",
    }],
    embedded=True,
)
check("id column", "Employee ID" in html, True)
check("live code", "BX099" in html, True)
check("break times", "Break times" in html, True)
check("punctuality", "Punctuality" in html, True)
check("leave", ">Leave<" in html or "Leave</th>" in html, True)
check("extra kept", ">Extra<" in html or "Extra</th>" in html, True)
check("window cell", "2:00 PM–2:20 PM" in html, True)

print("6. A check-in after a checkout is a check-in, not a two-minute break")
check("return", classify_punch_alert("break_in", "in", "break_out"), "break_end")
check("second in", classify_punch_alert("check_in", "in", "check_out"), "check_in")
check("phone back", classify_punch_alert(None, "in", "break_out"), "break_end")
check("phone in", classify_punch_alert(None, "in", "check_out"), "check_in")
check("leave", classify_punch_alert("check_out", "out", "break_out"), "check_out")

print()
print("ALL PASS" if ok else "FAILURES - read above")
sys.exit(0 if ok else 1)
