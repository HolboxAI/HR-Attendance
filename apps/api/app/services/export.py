"""Month-end attendance export.

The PRD calls owning this data "the entire reason" for the project, and the
acceptance criterion is one click. So this produces the shape an Indian HR or
payroll person actually expects - a monthly register, one row per employee,
one column per day - rather than a dump of rows they would have to pivot.

CSV rather than .xlsx on purpose: Excel opens it directly, it needs no new
dependency, and unlike a binary workbook it can be diffed, grepped and checked
into a payroll folder without a viewer. Formatting can come later if HR asks.

Nothing here computes pay. Payroll is explicitly out of v1, so this reports
FACTS - how many days of each kind, how many hours, how much unpaid leave -
and lets whoever runs payroll apply their own formula. The one derived figure,
`days_payable`, states its formula in the file header so it can be checked or
ignored.
"""

from __future__ import annotations

import calendar
import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.enums import AttendanceStatus, LeaveStatus
from app.models.leave import LeaveRequest, LeaveType
from app.models.org import Department
from app.services.attendance import recompute_day

# One short code per status. A register is read at a glance across 31 columns,
# so these have to be two characters at most.
CODE = {
    AttendanceStatus.PRESENT: "P",
    AttendanceStatus.HALF_DAY: "HD",
    AttendanceStatus.ABSENT: "A",
    AttendanceStatus.ON_LEAVE: "L",
    AttendanceStatus.WEEKLY_OFF: "WO",
    AttendanceStatus.HOLIDAY: "PH",
    AttendanceStatus.NOT_MARKED: "-",
}

LEGEND = ("P present · HD half day · A absent · L leave · "
          "WO weekly off · PH public holiday · - not marked")


@dataclass
class Row:
    employee: Employee
    department: str
    days: dict[int, str] = field(default_factory=dict)
    present: float = 0.0
    half_day: int = 0
    absent: int = 0
    on_leave: float = 0.0
    lop: float = 0.0
    weekly_off: int = 0
    holiday: int = 0
    not_marked: int = 0
    worked_minutes: int = 0
    late_minutes: int = 0
    overtime_minutes: int = 0
    exceptions: int = 0

    @property
    def days_payable(self) -> float:
        # Present + half days + PAID leave + weekly offs + holidays.
        # Unpaid (LOP) leave is deliberately excluded, which is the only
        # payroll-shaped opinion in this file and it is stated in the header.
        return (self.present + self.half_day * 0.5
                + (self.on_leave - self.lop) + self.weekly_off + self.holiday)


def _unpaid_leave_days(db: Session, employee: Employee, start: date, end: date) -> set[date]:
    """Dates in range covered by APPROVED leave of an unpaid type."""
    rows = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.from_date <= end,
            LeaveRequest.to_date >= start,
            LeaveRequest.deleted_at.is_(None),
        )
    ).all()
    unpaid: set[date] = set()
    for r in rows:
        lt = db.get(LeaveType, r.leave_type_id)
        if lt is None or lt.is_paid:
            continue
        day = max(r.from_date, start)
        while day <= min(r.to_date, end):
            unpaid.add(day)
            day = date.fromordinal(day.toordinal() + 1)
    return unpaid


def build(db: Session, *, employees: list[Employee], year: int, month: int) -> list[Row]:
    """Recompute every day for every employee and fold it into register rows.

    Recomputed, not read from a cache, for the same reason the board is: the
    export is the document someone gets paid from, and it must not be able to
    disagree with the punches behind it.
    """
    _, last = calendar.monthrange(year, month)
    start, end = date(year, month, 1), date(year, month, last)

    out: list[Row] = []
    for emp in employees:
        dept = db.get(Department, emp.department_id) if emp.department_id else None
        row = Row(employee=emp, department=dept.name if dept else "")
        unpaid = _unpaid_leave_days(db, emp, start, end)

        for d in range(1, last + 1):
            on = date(year, month, d)
            rec = recompute_day(db, emp, on)
            row.days[d] = CODE.get(rec.status, "?")

            if rec.status == AttendanceStatus.PRESENT:
                row.present += 1
            elif rec.status == AttendanceStatus.HALF_DAY:
                row.half_day += 1
            elif rec.status == AttendanceStatus.ABSENT:
                row.absent += 1
            elif rec.status == AttendanceStatus.ON_LEAVE:
                row.on_leave += 1
                if on in unpaid:
                    row.lop += 1
            elif rec.status == AttendanceStatus.WEEKLY_OFF:
                row.weekly_off += 1
            elif rec.status == AttendanceStatus.HOLIDAY:
                row.holiday += 1
            else:
                row.not_marked += 1

            row.worked_minutes += rec.worked_minutes
            row.late_minutes += rec.late_minutes
            row.overtime_minutes += rec.overtime_minutes
            if rec.has_exception:
                row.exceptions += 1

        out.append(row)
    return out


def to_pdf(rows: list[Row], *, year: int, month: int, org_name: str) -> bytes:
    """The same register as a printable PDF - landscape A4, one row per
    employee, one narrow column per day, the totals block on the right.

    Same `build()` rows as the CSV, so the two formats cannot disagree.
    The PDF exists because "email HR the register" usually means a document
    someone signs and files, not a spreadsheet; the CSV stays the payroll
    format. fpdf2 is imported here, not at module top, so the CSV path never
    depends on it.
    """
    from fpdf import FPDF

    _, last = calendar.monthrange(year, month)

    pdf = FPDF(orientation="landscape", format="A4")
    pdf.set_auto_page_break(auto=True, margin=10)
    pdf.set_margins(8, 10, 8)
    pdf.add_page()

    # Column plan across the 281mm printable width: identity block, one slim
    # column per day, then the totals that HR actually reads.
    day_w = 5.4
    id_w = {"code": 14, "name": 34}
    totals = [
        ("P", "present", 9), ("HD", "half_day", 9), ("A", "absent", 9),
        ("L", "on_leave", 9), ("LOP", "lop", 10), ("Pay", "days_payable", 11),
        ("Hours", "hours", 13),
    ]

    def header_block() -> None:
        pdf.set_font("helvetica", "B", 13)
        pdf.cell(0, 7, f"{org_name} - Attendance Register - {date(year, month, 1):%B %Y}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("helvetica", "", 7)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 4, f"Generated {stamp} - recomputed from punch events at export time.",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 4, LEGEND, new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 4, "Days payable = present + half days + PAID leave + weekly offs + "
                       "public holidays; unpaid (LOP) leave excluded and listed separately.",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

        pdf.set_font("helvetica", "B", 6)
        pdf.set_fill_color(240, 240, 242)
        pdf.cell(id_w["code"], 8, "Code", border=1, fill=True, align="C")
        pdf.cell(id_w["name"], 8, "Name", border=1, fill=True)
        for d in range(1, last + 1):
            wd = date(year, month, d).weekday()
            pdf.set_fill_color(226, 226, 230) if wd == 6 else pdf.set_fill_color(240, 240, 242)
            pdf.cell(day_w, 8, f"{d}", border=1, fill=True, align="C")
        pdf.set_fill_color(240, 240, 242)
        for label, _key, w in totals:
            pdf.cell(w, 8, label, border=1, fill=True, align="C")
        pdf.ln()

    header_block()
    pdf.set_font("helvetica", "", 6.5)
    for r in rows:
        if pdf.get_y() > 185:            # room for one more row, else new page
            pdf.add_page()
            header_block()
            pdf.set_font("helvetica", "", 6.5)

        pdf.set_font("helvetica", "", 6.5)
        pdf.cell(id_w["code"], 6, r.employee.emp_code, border=1)
        name = r.employee.full_name
        pdf.cell(id_w["name"], 6, name if len(name) <= 22 else name[:21] + "...", border=1)
        for d in range(1, last + 1):
            code = r.days.get(d, "")
            # An absence should be findable at arm's length: light red fill,
            # never colour alone - the code letter is still the signal.
            if code == "A":
                pdf.set_fill_color(252, 228, 228)
            elif code in ("WO", "PH"):
                pdf.set_fill_color(238, 238, 241)
            else:
                pdf.set_fill_color(255, 255, 255)
            pdf.cell(day_w, 6, code, border=1, fill=True, align="C")
        vals = {
            "present": f"{r.present:g}", "half_day": str(r.half_day),
            "absent": str(r.absent), "on_leave": f"{r.on_leave:g}",
            "lop": f"{r.lop:g}", "days_payable": f"{r.days_payable:g}",
            "hours": f"{r.worked_minutes // 60}:{r.worked_minutes % 60:02d}",
        }
        pdf.set_fill_color(255, 255, 255)
        for _label, key, w in totals:
            pdf.cell(w, 6, vals[key], border=1, align="C")
        pdf.ln()

    return bytes(pdf.output())


def to_csv(rows: list[Row], *, year: int, month: int, org_name: str) -> str:
    _, last = calendar.monthrange(year, month)
    buf = io.StringIO()
    w = csv.writer(buf)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    w.writerow([f"{org_name} - attendance register"])
    w.writerow([f"{date(year, month, 1):%B %Y}"])
    w.writerow([f"Generated {stamp}. Recomputed from punch events at export time."])
    w.writerow([LEGEND])
    w.writerow(["Days payable = present + half days + PAID leave + weekly offs "
                "+ public holidays. Unpaid (LOP) leave is excluded and listed "
                "separately. Check this against your own payroll rule."])
    w.writerow([])

    header = ["Code", "Name", "Department"]
    header += [f"{d:02d} {date(year, month, d):%a}" for d in range(1, last + 1)]
    header += ["Present", "Half days", "Absent", "Leave", "of which LOP",
               "Weekly off", "Holidays", "Not marked", "Days payable",
               "Hours worked", "Late (min)", "OT (min)", "Exceptions"]
    w.writerow(header)

    for r in rows:
        line = [r.employee.emp_code, r.employee.full_name, r.department]
        line += [r.days.get(d, "") for d in range(1, last + 1)]
        line += [
            f"{r.present:g}", r.half_day, r.absent, f"{r.on_leave:g}", f"{r.lop:g}",
            r.weekly_off, r.holiday, r.not_marked, f"{r.days_payable:g}",
            f"{r.worked_minutes // 60}:{r.worked_minutes % 60:02d}",
            r.late_minutes, r.overtime_minutes, r.exceptions,
        ]
        w.writerow(line)

    return buf.getvalue()
