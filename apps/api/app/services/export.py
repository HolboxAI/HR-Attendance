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


def _clean_pdf_text(text: str | None) -> str:
    if not text:
        return ""
    replacements = {
        "\u2014": "-",  # em-dash
        "\u2013": "-",  # en-dash
        "\u2018": "'",  # left single quote
        "\u2019": "'",  # right single quote
        "\u201c": '"',  # left double quote
        "\u201d": '"',  # right double quote
        "\u2022": "*",  # bullet
        "\u2026": "...",# ellipsis
        "\u00a0": " ",  # non-breaking space
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def employee_to_pdf(
    employee: Employee,
    department: str | None,
    days: list[dict],
    totals: dict,
    start_date: date,
    end_date: date,
    org_name: str,
) -> bytes:
    """Generate a clean, printable PDF attendance report for a single employee over any date range."""
    from fpdf import FPDF

    safe_org_name = _clean_pdf_text(org_name)
    safe_emp_name = _clean_pdf_text(employee.full_name)
    safe_dept_name = _clean_pdf_text(department or "General")

    class EmployeePDF(FPDF):
        def header(self):
            self.set_font("helvetica", "B", 8)
            self.set_text_color(120, 120, 130)
            self.cell(0, 4, f"{safe_org_name.upper()} - EMPLOYEE ATTENDANCE REPORT", align="L")
            self.ln(2)

        def footer(self):
            self.set_y(-12)
            self.set_font("helvetica", "", 8)
            self.set_text_color(150, 150, 155)
            self.cell(0, 6, f"Page {self.page_no()} of {{nb}} - Confidential", align="C")

    pdf = EmployeePDF(orientation="portrait", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(10, 12, 10)
    pdf.add_page()

    # Employee Name & Details
    pdf.set_font("helvetica", "B", 18)
    pdf.set_text_color(20, 24, 33)
    pdf.cell(0, 8, safe_emp_name, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(100, 105, 115)
    date_str = f"{start_date:%d %b %Y} to {end_date:%d %b %Y}"
    meta_line = f"Employee Code: {employee.emp_code}   |   Department: {safe_dept_name}   |   Period: {date_str}"
    pdf.cell(0, 5, meta_line, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # Summary KPI Cards Box
    pdf.set_fill_color(248, 249, 251)
    pdf.set_draw_color(226, 228, 233)
    pdf.rect(10, pdf.get_y(), 190, 18, style="FD")

    worked_hrs = totals.get("worked_minutes", 0)
    hrs_str = f"{worked_hrs // 60}h {worked_hrs % 60:02d}m"
    late_mins = totals.get("late_minutes", 0)
    late_str = f"{late_mins}m" if late_mins > 0 else "-"
    
    leaves_by_type = totals.get("leaves_by_type", {})
    type_details = ", ".join(f"{k}: {v:g}" for k, v in leaves_by_type.items()) if leaves_by_type else ""
    leave_count = totals.get("on_leave", 0)
    leave_str = f"{leave_count} ({type_details})" if type_details else str(leave_count)

    kpis = [
        ("PRESENT", str(totals.get("present", 0))),
        ("ABSENT", str(totals.get("absent", 0))),
        ("LEAVES", leave_str),
        ("HALF DAY", str(totals.get("half_day", 0))),
        ("WFH", str(totals.get("wfh", 0))),
        ("HOURS", hrs_str),
        ("LATE", late_str),
    ]

    box_w = 190 / len(kpis)
    start_y = pdf.get_y()
    for i, (label, val) in enumerate(kpis):
        x = 10 + i * box_w
        pdf.set_xy(x, start_y + 2)
        pdf.set_font("helvetica", "B", 7)
        pdf.set_text_color(120, 125, 135)
        pdf.cell(box_w, 4, label, align="C")
        pdf.set_xy(x, start_y + 7)
        pdf.set_font("helvetica", "B", 9.5)
        pdf.set_text_color(20, 24, 33)
        pdf.cell(box_w, 6, val, align="C")

    pdf.set_y(start_y + 22)

    # Table Header
    cols = [
        ("Date", 26),
        ("Day", 12),
        ("Status", 34),
        ("In", 18),
        ("Out", 18),
        ("Hours", 18),
        ("Late", 16),
        ("Notes / Regularization", 48),
    ]

    def render_table_header():
        pdf.set_fill_color(238, 240, 244)
        pdf.set_draw_color(218, 220, 226)
        pdf.set_font("helvetica", "B", 8)
        pdf.set_text_color(60, 64, 75)
        for title, w in cols:
            pdf.cell(w, 7, title, border=1, fill=True, align="C")
        pdf.ln()

    render_table_header()

    # Table Rows
    pdf.set_font("helvetica", "", 8)
    for d in days:
        if pdf.get_y() > 270:
            pdf.add_page()
            render_table_header()
            pdf.set_font("helvetica", "", 8)

        st_val = d.get("status", "")
        # Format status display
        if st_val == "present":
            st_label = "Present"
        elif st_val == "absent":
            st_label = "Absent"
        elif st_val in ("on_leave", "half_day"):
            code = d.get("leave_code")
            base = "Half Day" if st_val == "half_day" else "On Leave"
            st_label = f"{base} ({code})" if code else base
        elif st_val == "wfh":
            st_label = "Work From Home"
        elif st_val == "weekly_off":
            st_label = "Weekly Off"
        elif st_val == "holiday":
            st_label = "Holiday"
        else:
            st_label = st_val.replace("_", " ").title()

        if d.get("is_wfh") and st_val != "wfh":
            st_label += " (WFH)"

        # Set row colors
        if st_val == "absent":
            pdf.set_fill_color(254, 242, 242)
            pdf.set_text_color(185, 28, 28)
        elif st_val in ("on_leave", "half_day"):
            pdf.set_fill_color(254, 243, 199)
            pdf.set_text_color(180, 83, 9)
        elif st_val == "wfh" or d.get("is_wfh"):
            pdf.set_fill_color(236, 254, 255)
            pdf.set_text_color(14, 116, 144)
        elif st_val in ("weekly_off", "holiday"):
            pdf.set_fill_color(248, 249, 250)
            pdf.set_text_color(140, 140, 145)
        else:
            pdf.set_fill_color(255, 255, 255)
            pdf.set_text_color(30, 35, 45)

        pdf.cell(26, 6, d.get("date", ""), border=1, fill=True, align="C")
        pdf.cell(12, 6, d.get("weekday", ""), border=1, fill=True, align="C")
        pdf.cell(34, 6, _clean_pdf_text(st_label), border=1, fill=True, align="L")
        
        pdf.set_text_color(30, 35, 45)
        in_t = d.get("first_in")
        in_str = in_t[11:16] if in_t and len(in_t) >= 16 else "-"
        out_t = d.get("last_out")
        out_str = out_t[11:16] if out_t and len(out_t) >= 16 else "-"
        pdf.cell(18, 6, in_str, border=1, fill=True, align="C")
        pdf.cell(18, 6, out_str, border=1, fill=True, align="C")

        w_min = d.get("worked_minutes", 0)
        h_str = f"{w_min // 60}h {w_min % 60:02d}m" if w_min > 0 else "-"
        pdf.cell(18, 6, h_str, border=1, fill=True, align="C")

        l_min = d.get("late_minutes", 0)
        l_str = f"{l_min}m" if l_min > 0 else "-"
        pdf.cell(16, 6, l_str, border=1, fill=True, align="C")

        notes = []
        if d.get("is_regularized"):
            notes.append("[Corrected]")
        if d.get("exception_note"):
            notes.append(d["exception_note"])
        if d.get("leave_name") and st_val in ("on_leave", "half_day"):
            notes.append(d["leave_name"])

        full_note = " ".join(notes)
        note_str = full_note if len(full_note) <= 30 else full_note[:28] + "..."
        pdf.set_font("helvetica", "", 7)
        pdf.cell(48, 6, _clean_pdf_text(note_str), border=1, fill=True, align="L")
        pdf.set_font("helvetica", "", 8)
        pdf.ln()

    return bytes(pdf.output())
