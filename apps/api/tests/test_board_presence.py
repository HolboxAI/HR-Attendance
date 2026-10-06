"""Run: python3 tests/test_board_presence.py

A standing WFH assignment stays remote until HR turns it off. That person
still checks in, so the day is present and labelled wfh. They are not
"in the office".
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.attendance import counts_for_board  # noqa: E402

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


print("1. Office check-in is in the office and present")
check("office", counts_for_board("present", in_now=True, is_wfh=False), (True, True))

print("2. Standing WFH check-in is present, on the WFH list, not in the office")
check("wfh", counts_for_board("wfh", in_now=True, is_wfh=True), (False, True))

print("3. WFH with no check-in is neither")
check("wfh waiting", counts_for_board("not_marked", in_now=False, is_wfh=True), (False, False))
check("wfh absent", counts_for_board("absent", in_now=False, is_wfh=True), (False, False))

print("4. Checked out of the office is present, not in the office")
check("left", counts_for_board("present", in_now=False, is_wfh=False), (False, True))

print()
print("ALL PASS" if ok else "FAILURES - read above")
sys.exit(0 if ok else 1)
