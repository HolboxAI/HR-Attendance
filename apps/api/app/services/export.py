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
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")

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



def _format_time_ist(t_val, tz: ZoneInfo = IST) -> str:
    if not t_val:
        return "-"
    if isinstance(t_val, str):
        try:
            t_val = datetime.fromisoformat(t_val.replace("Z", "+00:00"))
        except Exception:
            return t_val[11:16]
    if hasattr(t_val, "tzinfo"):
        if t_val.tzinfo is None:
            t_val = t_val.replace(tzinfo=timezone.utc)
        return t_val.astimezone(tz).strftime("%I:%M %p")
    return "-"

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
    """One employee's days, in the same columns as the history PDF and the mail."""
    rows = []
    for d in days:
        rows.append({
            "shift_date": d.get("date"),
            "employee_code": d.get("employee_code") or employee.emp_code,
            "full_name": d.get("full_name") or employee.full_name,
            "department": d.get("department") or department,
            "status": d.get("status"),
            "first_in": d.get("first_in"),
            "last_out": d.get("last_out"),
            "worked_minutes": d.get("worked_minutes"),
            "break_minutes": d.get("break_minutes"),
            "late_minutes": d.get("late_minutes"),
            "shift_allotted": d.get("shift_allotted") or "-",
            "break_windows": d.get("break_windows") or "-",
            "extra_str": d.get("extra_str") or "-",
            "punctuality": d.get("punctuality") or "-",
            "regularised_by": d.get("regularised_by") or "N/A",
            "leave_status": d.get("leave_status") or "N/A",
            "leave_approved_by": d.get("leave_approved_by") or "N/A",
            "remarks": d.get("remarks") or d.get("exception_note") or "-",
        })
    who = f"Employee: {employee.full_name} ({employee.emp_code})"
    return attendance_history_to_pdf(rows, start_date, end_date, org_name, filters_desc=who)


def employee_to_csv(
    employee: Employee,
    department: str | None,
    days: list[dict],
    totals: dict,
    start_date: date,
    end_date: date,
    org_name: str,
) -> str:
    """One employee's days, in the same columns as the history CSV and the mail."""
    rows = []
    for d in days:
        rows.append({
            "shift_date": d.get("date"),
            "employee_code": d.get("employee_code") or employee.emp_code,
            "full_name": d.get("full_name") or employee.full_name,
            "department": d.get("department") or department,
            "status": d.get("status"),
            "first_in": d.get("first_in"),
            "last_out": d.get("last_out"),
            "worked_minutes": d.get("worked_minutes"),
            "break_minutes": d.get("break_minutes"),
            "late_minutes": d.get("late_minutes"),
            "shift_allotted": d.get("shift_allotted") or "-",
            "break_windows": d.get("break_windows") or "-",
            "extra_str": d.get("extra_str") or "-",
            "punctuality": d.get("punctuality") or "-",
            "regularised_by": d.get("regularised_by") or "N/A",
            "leave_status": d.get("leave_status") or "N/A",
            "leave_approved_by": d.get("leave_approved_by") or "N/A",
            "remarks": d.get("remarks") or d.get("exception_note") or "-",
        })
    who = f"Employee: {employee.full_name} ({employee.emp_code})"
    return attendance_history_to_csv(rows, start_date=start_date, end_date=end_date, org_name=org_name, filters_desc=who)


def attendance_history_to_pdf(
    rows: list[dict],
    start_date: date,
    end_date: date,
    org_name: str,
    filters_desc: str | None = None,
) -> bytes:
    """Generate a high-grade landscape PDF attendance register report for filtered history records."""
    from fpdf import FPDF

    safe_org_name = _clean_pdf_text(org_name or "Holbox AI")

    class HistoryPDF(FPDF):
        def header(self):
            self.set_font("helvetica", "B", 8)
            self.set_text_color(120, 120, 130)
            self.cell(0, 4, f"{safe_org_name.upper()} - ATTENDANCE REGISTER & HISTORY", align="L")
            self.ln(2)

        def footer(self):
            self.set_y(-12)
            self.set_font("helvetica", "", 7.5)
            self.set_text_color(150, 150, 155)
            now_str = datetime.now().strftime("%d %b %Y %H:%M")
            self.cell(0, 6, f"Page {self.page_no()} of {{nb}}  |  Generated {now_str}  |  Confidential Attendance Record", align="C")

    pdf = HistoryPDF(orientation="landscape", format="A3")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(8, 12, 8)
    pdf.add_page()

    # Report Title & Summary Metadata
    pdf.set_font("helvetica", "B", 16)
    pdf.set_text_color(20, 24, 33)
    pdf.cell(0, 7, "Attendance Register & History Report", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("helvetica", "", 8.5)
    pdf.set_text_color(90, 95, 105)
    if start_date == end_date:
        period_str = f"Date: {start_date:%d %b %Y}"
    else:
        period_str = f"Period: {start_date:%d %b %Y} to {end_date:%d %b %Y}"

    filter_info = f"Filters: {filters_desc}" if filters_desc else "Filters: All Records"
    meta_line = f"{period_str}   |   Organization: {safe_org_name}   |   {filter_info}"
    pdf.cell(0, 5, _clean_pdf_text(meta_line), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Compute Summary KPIs
    total_count = len(rows)
    present_count = sum(1 for r in rows if r.get("status") == "present")
    absent_count = sum(1 for r in rows if r.get("status") == "absent")
    leave_count = sum(1 for r in rows if r.get("status") in ("on_leave", "half_day"))
    wfh_count = sum(1 for r in rows if r.get("status") == "wfh")
    late_count = sum(1 for r in rows if (r.get("late_minutes") or 0) > 0)
    corrections_count = sum(1 for r in rows if r.get("is_regularized"))
    total_mins = sum((r.get("worked_minutes") or 0) for r in rows)
    hrs_str = f"{total_mins // 60}h {total_mins % 60:02d}m"

    kpis = [
        ("TOTAL RECORDS", str(total_count)),
        ("PRESENT", str(present_count)),
        ("ABSENT", str(absent_count)),
        ("ON LEAVE / HD", str(leave_count)),
        ("WFH", str(wfh_count)),
        ("LATE", str(late_count)),
        ("CORRECTIONS", str(corrections_count)),
        ("TOTAL HOURS", hrs_str),
    ]

    # Render KPI Summary Box. A3 landscape fits the same columns as the mail.
    total_w = 404.0
    box_w = total_w / len(kpis)
    start_y = pdf.get_y()
    pdf.set_fill_color(248, 249, 251)
    pdf.set_draw_color(226, 228, 233)
    pdf.rect(8, start_y, total_w, 14, style="FD")

    for i, (label, val) in enumerate(kpis):
        bx = 8 + i * box_w
        pdf.set_xy(bx, start_y + 1.5)
        pdf.set_font("helvetica", "B", 6.5)
        pdf.set_text_color(120, 125, 135)
        pdf.cell(box_w, 3.5, label, align="C")
        pdf.set_xy(bx, start_y + 5.5)
        pdf.set_font("helvetica", "B", 9)
        pdf.set_text_color(20, 24, 33)
        pdf.cell(box_w, 6, val, align="C")

    pdf.set_y(start_y + 17)

    # Same columns as the 11:59 mail. Widths sum to the A3 content width.
    cols = [
        ("Date", 20, "C"),
        ("Employee ID", 18, "C"),
        ("Name", 28, "L"),
        ("Department", 22, "L"),
        ("Shift", 26, "L"),
        ("Status", 16, "C"),
        ("In", 16, "C"),
        ("Out", 16, "C"),
        ("Late", 12, "C"),
        ("Break times", 28, "L"),
        ("Break total", 14, "C"),
        ("Worked", 14, "C"),
        ("Extra", 12, "C"),
        ("Punctuality", 20, "C"),
        ("Regularised by", 24, "L"),
        ("Leave", 14, "C"),
        ("Approved by", 22, "L"),
        ("Remarks", 82, "L"),
    ]

    def render_table_header():
        pdf.set_fill_color(238, 240, 244)
        pdf.set_draw_color(218, 220, 226)
        pdf.set_font("helvetica", "B", 6)
        pdf.set_text_color(50, 55, 65)
        for title, w, align in cols:
            pdf.cell(w, 6.5, title, border=1, fill=True, align=align)
        pdf.ln()

    render_table_header()

    if not rows:
        pdf.set_font("helvetica", "I", 8.5)
        pdf.set_text_color(120, 120, 130)
        pdf.cell(total_w, 10, "No attendance records found matching the active filters.", border=1, align="C")
        pdf.ln()
        return bytes(pdf.output())

    pdf.set_font("helvetica", "", 6)
    for r in rows:
        if pdf.get_y() > 270:
            pdf.add_page()
            render_table_header()
            pdf.set_font("helvetica", "", 6)

        # Date formatting
        s_date = r.get("shift_date")
        if hasattr(s_date, "strftime"):
            date_str = s_date.strftime("%d %b %Y")
        elif isinstance(s_date, str) and len(s_date) >= 10:
            try:
                date_str = datetime.strptime(s_date[:10], "%Y-%m-%d").strftime("%d %b %Y")
            except Exception:
                date_str = s_date[:10]
        else:
            date_str = str(s_date or "-")

        # Employee code & name
        code_str = str(r.get("employee_code") or "")
        name_val = str(r.get("full_name") or "")
        safe_name = name_val if len(name_val) <= 24 else name_val[:23] + "..."
        dept_val = str(r.get("department") or "-")
        safe_dept = dept_val if len(dept_val) <= 18 else dept_val[:17] + "..."

        # Status text & colors
        st_val = str(r.get("status") or "").lower()
        if st_val == "present":
            st_label = "Present"
            pdf.set_fill_color(240, 253, 244)
            pdf.set_text_color(22, 101, 52)
        elif st_val == "absent":
            st_label = "Absent"
            pdf.set_fill_color(254, 242, 242)
            pdf.set_text_color(185, 28, 28)
        elif st_val in ("on_leave", "half_day"):
            st_label = "Half Day" if st_val == "half_day" else "On Leave"
            pdf.set_fill_color(254, 243, 199)
            pdf.set_text_color(180, 83, 9)
        elif st_val == "wfh":
            st_label = "WFH"
            pdf.set_fill_color(236, 254, 255)
            pdf.set_text_color(14, 116, 144)
        elif st_val in ("weekly_off", "holiday"):
            st_label = "Weekly Off" if st_val == "weekly_off" else "Holiday"
            pdf.set_fill_color(248, 249, 250)
            pdf.set_text_color(130, 135, 145)
        else:
            st_label = st_val.replace("_", " ").title()
            pdf.set_fill_color(255, 255, 255)
            pdf.set_text_color(30, 35, 45)

        def clip(value, limit: int) -> str:
            text = _clean_pdf_text(str(value if value not in (None, "") else "-"))
            return text if len(text) <= limit else text[: limit - 1] + "."

        w_min = r.get("worked_minutes") or 0
        in_str = "-" if st_val in ("weekly_off", "holiday") and w_min <= 0 else _format_time_ist(r.get("first_in"))
        out_str = "-" if st_val in ("weekly_off", "holiday") and w_min <= 0 else _format_time_ist(r.get("last_out"))
        h_str = f"{w_min // 60}h {w_min % 60:02d}m" if w_min > 0 else "-"
        b_min = r.get("break_minutes") or 0
        b_str = f"{b_min}m" if b_min > 0 else "-"
        l_min = 0 if st_val in ("weekly_off", "holiday") and w_min <= 0 else (r.get("late_minutes") or 0)
        l_str = f"{l_min}m" if l_min > 0 else "-"
        remarks = r.get("remarks") or "-"

        values = [
            date_str,
            clip(code_str, 10),
            clip(safe_name, 18),
            clip(safe_dept, 14),
            clip(r.get("shift_allotted") or "-", 16),
            clip(st_label, 10),
            in_str,
            out_str,
            l_str,
            clip(r.get("break_windows") or "-", 18),
            b_str,
            h_str,
            clip(r.get("extra_str") or "-", 8),
            clip(r.get("punctuality") or "-", 12),
            clip(r.get("regularised_by") or "N/A", 22),
            clip(r.get("leave_status") or "N/A", 8),
            clip(r.get("leave_approved_by") or "N/A", 22),
            clip(remarks, 75),
        ]
        pdf.set_font("helvetica", "", 6)
        for (title, width, align), value in zip(cols, values):
            if title == "Status":
                pdf.cell(width, 5.5, value, border=1, fill=True, align=align)
                pdf.set_text_color(30, 35, 45)
            elif title == "Late" and l_min > 0:
                pdf.set_text_color(180, 83, 9)
                pdf.cell(width, 5.5, value, border=1, fill=True, align=align)
                pdf.set_text_color(30, 35, 45)
            else:
                pdf.cell(width, 5.5, value, border=1, fill=True, align=align)
        pdf.ln()

    return bytes(pdf.output())


def attendance_history_to_csv(
    rows: list[dict],
    *,
    start_date: date,
    end_date: date,
    org_name: str,
    filters_desc: str | None = None,
) -> str:
    """Generate Excel-ready CSV attendance register report for filtered history records."""
    buf = io.StringIO()
    # UTF-8 BOM so Microsoft Excel automatically opens with proper encoding
    buf.write("\ufeff")
    w = csv.writer(buf)

    # Clean org name
    safe_org_name = org_name or "Holbox AI"
    period_str = f"{start_date:%d %b %Y}" if start_date == end_date else f"{start_date:%d %b %Y} to {end_date:%d %b %Y}"
    filter_info = filters_desc if filters_desc else "All Records"

    # Header section
    w.writerow(["Attendance Register & History Report"])
    w.writerow(["Organization", safe_org_name])
    w.writerow(["Period", period_str])
    w.writerow(["Filters Applied", filter_info])
    w.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %I:%M %p")])
    w.writerow([])

    # KPI summary
    total_count = len(rows)
    present_count = sum(1 for r in rows if str(r.get("status") or "").lower() == "present")
    absent_count = sum(1 for r in rows if str(r.get("status") or "").lower() == "absent")
    leave_count = sum(1 for r in rows if str(r.get("status") or "").lower() in ("on_leave", "half_day", "leave"))
    wfh_count = sum(1 for r in rows if str(r.get("status") or "").lower() == "wfh")
    late_count = sum(1 for r in rows if (r.get("late_minutes") or 0) > 0)
    corrections_count = sum(1 for r in rows if r.get("is_regularized") or r.get("punctuality") == "Regularised")
    total_mins = sum((r.get("worked_minutes") or 0) for r in rows)
    hrs_str = f"{total_mins // 60}h {total_mins % 60:02d}m"

    w.writerow(["TOTAL RECORDS", "PRESENT", "ABSENT", "ON LEAVE / HALF DAY", "WFH", "LATE", "CORRECTIONS", "TOTAL WORKED HOURS"])
    w.writerow([total_count, present_count, absent_count, leave_count, wfh_count, late_count, corrections_count, hrs_str])
    w.writerow([])

    # Table columns
    cols = [
        "#",
        "Date",
        "Employee ID",
        "Employee Name",
        "Department",
        "Shift",
        "Status",
        "Punch-in Time",
        "Punch-out Time",
        "Late",
        "Break Times",
        "Break Total",
        "Worked Hours",
        "Extra Hours",
        "Punctuality",
        "Regularised By",
        "Leave Status",
        "Leave Approved By",
        "Remarks",
    ]
    w.writerow(cols)

    for idx, r in enumerate(rows, 1):
        s_date = r.get("shift_date")
        if hasattr(s_date, "strftime"):
            date_str = s_date.strftime("%d %b %Y")
        elif isinstance(s_date, str) and len(s_date) >= 10:
            try:
                date_str = datetime.strptime(s_date[:10], "%Y-%m-%d").strftime("%d %b %Y")
            except Exception:
                date_str = s_date[:10]
        else:
            date_str = str(s_date or "-")

        st_val = str(r.get("status") or "").lower()
        if st_val == "present":
            st_label = "Present"
        elif st_val == "absent":
            st_label = "Absent"
        elif st_val in ("on_leave", "half_day"):
            st_label = "Half Day" if st_val == "half_day" else "On Leave"
        elif st_val == "wfh":
            st_label = "WFH"
        elif st_val in ("weekly_off", "holiday"):
            st_label = "Weekly Off" if st_val == "weekly_off" else "Holiday"
        else:
            st_label = st_val.replace("_", " ").title()

        w_min = r.get("worked_minutes") or 0
        in_str = "-" if st_val in ("weekly_off", "holiday") and w_min <= 0 else _format_time_ist(r.get("first_in"))
        out_str = "-" if st_val in ("weekly_off", "holiday") and w_min <= 0 else _format_time_ist(r.get("last_out"))
        h_str = f"{w_min // 60}h {w_min % 60:02d}m" if w_min > 0 else "-"
        b_min = r.get("break_minutes") or 0
        b_str = f"{b_min}m" if b_min > 0 else "-"
        l_min = 0 if st_val in ("weekly_off", "holiday") and w_min <= 0 else (r.get("late_minutes") or 0)
        l_str = f"{l_min}m" if l_min > 0 else "-"
        remarks = str(r.get("remarks") or "-")

        w.writerow([
            idx,
            date_str,
            str(r.get("employee_code") or ""),
            str(r.get("full_name") or ""),
            str(r.get("department") or "-"),
            str(r.get("shift_allotted") or "-"),
            st_label,
            in_str,
            out_str,
            l_str,
            str(r.get("break_windows") or "-"),
            b_str,
            h_str,
            str(r.get("extra_str") or "-"),
            str(r.get("punctuality") or "-"),
            str(r.get("regularised_by") or "N/A"),
            str(r.get("leave_status") or "N/A"),
            str(r.get("leave_approved_by") or "N/A"),
            remarks,
        ])

    return buf.getvalue()
