"""Generate an executive-grade, ultra-clean PNG summary card for Slack shift-end reports."""

from __future__ import annotations

import io
from datetime import date
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load standard system TrueType font with fallbacks."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSText.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def generate_shift_summary_image(
    *,
    shift_name: str,
    shift_timing: str,
    shift_date: date,
    stats: dict,
    roster: Sequence[dict],
) -> bytes:
    """Render a modern dark-mode attendance card into PNG bytes."""
    width = 1100
    row_height = 46
    header_height = 200
    footer_height = 60
    table_header_height = 40
    
    num_rows = max(len(roster), 1)
    height = header_height + table_header_height + (num_rows * row_height) + footer_height + 40

    img = Image.new("RGBA", (width, height), "#0B0F17")
    draw = ImageDraw.Draw(img)

    # Outer border
    draw.rounded_rectangle([(12, 12), (width - 12, height - 12)], radius=18, outline="#1E293B", width=2)

    # Fonts
    font_eyebrow = _load_font(12, bold=True)
    font_title = _load_font(22, bold=True)
    font_sub = _load_font(13, bold=False)
    font_kpi_num = _load_font(20, bold=True)
    font_kpi_label = _load_font(10, bold=True)
    font_th = _load_font(11, bold=True)
    font_td_name = _load_font(13, bold=True)
    font_td_code = _load_font(11, bold=False)
    font_td = _load_font(12, bold=False)
    font_badge = _load_font(10, bold=True)
    font_footer = _load_font(11, bold=False)

    # 1. Header Eyebrow & Title
    draw.text((40, 32), "HOLBOX AI  •  ATTENDANCE INTELLIGENCE", fill="#6366F1", font=font_eyebrow)
    draw.text((40, 52), f"📋 Shift Attendance Summary — {shift_name}", fill="#F8FAFC", font=font_title)
    
    date_str = shift_date.strftime("%A, %d %B %Y")
    draw.text((40, 88), f"🕒 {shift_timing}   •   📅 {date_str}", fill="#94A3B8", font=font_sub)

    # 2. KPI Cards (Total, Present, Late, Absent, Leave)
    kpis = [
        ("TOTAL", str(stats.get("total", len(roster))), "#334155", "#94A3B8"),
        ("PRESENT", str(stats.get("present", 0)), "#064E3B", "#34D399"),
        ("LATE", str(stats.get("late", 0)), "#78350F", "#FBBF24"),
        ("ABSENT", str(stats.get("absent", 0)), "#881337", "#FB7185"),
        ("ON LEAVE", str(stats.get("leave", 0)), "#4C1D95", "#C084FC"),
    ]

    card_w = 194
    card_h = 56
    card_gap = 12
    card_start_x = 40
    card_y = 122

    for i, (label, val, bg_col, text_col) in enumerate(kpis):
        cx = card_start_x + i * (card_w + card_gap)
        draw.rounded_rectangle([(cx, card_y), (cx + card_w, card_y + card_h)], radius=12, fill="#131B2E", outline=bg_col, width=1)
        draw.text((cx + 16, card_y + 10), val, fill=text_col, font=font_kpi_num)
        draw.text((cx + 16, card_y + 36), label, fill="#64748B", font=font_kpi_label)

    # 3. Table Header
    th_y = 200
    draw.rounded_rectangle([(40, th_y), (width - 40, th_y + 34)], radius=8, fill="#172238")
    
    col_x = {
        "emp": 56,
        "first_in": 360,
        "last_out": 490,
        "breaks": 620,
        "worked": 750,
        "status": 910,
    }

    draw.text((col_x["emp"], th_y + 10), "EMPLOYEE", fill="#94A3B8", font=font_th)
    draw.text((col_x["first_in"], th_y + 10), "FIRST IN", fill="#94A3B8", font=font_th)
    draw.text((col_x["last_out"], th_y + 10), "LAST OUT", fill="#94A3B8", font=font_th)
    draw.text((col_x["breaks"], th_y + 10), "BREAKS", fill="#94A3B8", font=font_th)
    draw.text((col_x["worked"], th_y + 10), "NET WORKED", fill="#94A3B8", font=font_th)
    draw.text((col_x["status"], th_y + 10), "STATUS", fill="#94A3B8", font=font_th)

    # 4. Table Rows
    curr_y = th_y + 40
    for idx, r in enumerate(roster):
        row_bg = "#0F1626" if idx % 2 == 0 else "#0B0F17"
        draw.rounded_rectangle([(40, curr_y), (width - 40, curr_y + row_height - 4)], radius=6, fill=row_bg)

        # Name & Code
        name_text = r.get("name", "Unknown")
        code_text = f"({r.get('code', '—')})"
        draw.text((col_x["emp"], curr_y + 8), name_text, fill="#F1F5F9", font=font_td_name)
        draw.text((col_x["emp"], curr_y + 26), code_text, fill="#64748B", font=font_td_code)

        # In & Out
        first_in = r.get("first_in") or "—"
        last_out = r.get("last_out") or "—"
        draw.text((col_x["first_in"], curr_y + 14), first_in, fill="#E2E8F0", font=font_td)
        draw.text((col_x["last_out"], curr_y + 14), last_out, fill="#E2E8F0", font=font_td)

        # Breaks & Worked
        break_str = r.get("break_str") or "0m"
        hours_str = r.get("hours_str") or "0m"
        draw.text((col_x["breaks"], curr_y + 14), break_str, fill="#94A3B8", font=font_td)
        draw.text((col_x["worked"], curr_y + 14), hours_str, fill="#38BDF8", font=font_td)

        # Status Badge
        st = (r.get("status") or "absent").lower()
        if st in ("present", "early"):
            badge_bg = "#064E3B"
            badge_text_col = "#34D399"
            badge_label = "PRESENT"
        elif st == "late":
            badge_bg = "#78350F"
            badge_text_col = "#FBBF24"
            late_m = r.get("late_minutes", 0)
            badge_label = f"LATE ({late_m}m)" if late_m > 0 else "LATE"
        elif st in ("on_leave", "leave", "half_day"):
            badge_bg = "#4C1D95"
            badge_text_col = "#C084FC"
            badge_label = "ON LEAVE"
        elif st in ("not_marked", "missing_out", "open", "unresolved"):
            badge_bg = "#854D0E"
            badge_text_col = "#FDE047"
            badge_label = "MISSING OUT"
        else:
            badge_bg = "#881337"
            badge_text_col = "#FB7185"
            badge_label = "ABSENT"

        bw = 110
        bx = col_x["status"]
        by = curr_y + 11
        draw.rounded_rectangle([(bx, by), (bx + bw, by + 22)], radius=11, fill=badge_bg)
        draw.text((bx + 12, by + 4), badge_label, fill=badge_text_col, font=font_badge)

        curr_y += row_height

    # 5. Footer
    draw.line([(40, curr_y + 10), (width - 40, curr_y + 10)], fill="#1E293B", width=1)
    draw.text((40, curr_y + 20), "⚡ Verified by Boxcode HRMS  •  Auto-generated at shift conclusion", fill="#64748B", font=font_footer)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
