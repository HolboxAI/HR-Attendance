"""Shared Holbox HTML chrome for outbound notification emails.

The mark is the live PNG already served by the dashboard. Do not replace it
with a drawn hexagon or a different file — Gmail loads this exact asset.
"""

from __future__ import annotations

from html import escape

PORTAL = "https://attendance.holbox.ai"
# Official isometric box. Hosted on the live dashboard so every client
# fetches the same file the site already uses.
LOGO_URL = f"{PORTAL}/holbox-logo.png"


def _e(value: object) -> str:
    return escape(str(value if value is not None else ""), quote=True)


# Small gray icons used in the detail rows. Inline SVG so the mail does
# not depend on a second image host.
_ICONS = {
    "person": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    "badge": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6"/></svg>',
    "mail": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    "dept": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-8h6v8"/></svg>',
    "briefcase": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></svg>',
    "check": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    "phone": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    "calendar": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    "clock": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    "chat": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
}


def _icon_cell(name: str) -> str:
    return (
        f'<td width="36" valign="middle" style="padding:12px 10px 12px 16px;">'
        f'<div style="width:28px;height:28px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;'
        f'text-align:center;line-height:28px;">{_ICONS[name]}</div></td>'
    )


def _detail_row(icon: str, label: str, value: str, *, last: bool = False, value_html: str | None = None) -> str:
    border = "" if last else "border-bottom:1px solid #f1f5f9;"
    shown = value_html if value_html is not None else _e(value)
    return f"""
      <tr>
        {_icon_cell(icon)}
        <td valign="middle" style="padding:12px 8px;{border}width:38%;">
          <div style="font-size:12px;color:#64748b;">{_e(label)}</div>
        </td>
        <td valign="middle" style="padding:12px 18px 12px 8px;{border}">
          <div style="font-size:14px;font-weight:700;color:#0f172a;">{shown}</div>
        </td>
      </tr>
    """


def _btn(href: str, label: str, *, bg: str, color: str = "#ffffff", border: str | None = None) -> str:
    extra = f"border:{border};" if border else "border:0;"
    return (
        f'<a href="{_e(href)}" style="display:inline-block;background:{bg};color:{color};'
        f'{extra}text-decoration:none;font-size:14px;font-weight:700;padding:13px 22px;'
        f'border-radius:10px;">{label}</a>'
    )


def wrap(inner: str, *, title: str, width: int = 640) -> str:
    """Light Holbox chrome — logo, nav, tagline, footer. Same on every mail."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{_e(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:{width}px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">

          <tr>
            <td style="padding:22px 28px;border-bottom:1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" width="42%">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="padding-right:10px;">
                          <img src="{LOGO_URL}" width="36" height="36" alt="Holbox" style="display:block;border:0;width:36px;height:36px;"/>
                        </td>
                        <td valign="middle">
                          <div style="font-size:15px;font-weight:800;letter-spacing:0.6px;color:#0f172a;line-height:1.1;">HOLBOX</div>
                          <div style="font-size:10px;font-weight:700;letter-spacing:1.4px;color:#64748b;margin-top:2px;">HRMS</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" align="center" style="font-size:12px;color:#94a3b8;">
                    People &nbsp;&bull;&nbsp; Attendance &nbsp;&bull;&nbsp; Leave
                  </td>
                  <td valign="middle" align="right" width="32%" style="font-size:11px;color:#94a3b8;font-style:italic;">
                    Building better workplaces together.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 8px 28px;">
              {inner}
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 26px 28px;border-top:1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" style="font-size:12px;color:#64748b;line-height:1.55;">
                    <div style="font-weight:800;color:#0f172a;margin-bottom:4px;">Holbox HRMS</div>
                    Automated notification from the Holbox Attendance System.<br>
                    Manage your team from the <a href="{PORTAL}" style="color:#2563eb;text-decoration:none;font-weight:600;">Admin Dashboard</a>.
                  </td>
                  <td valign="top" align="right" style="font-size:12px;color:#94a3b8;line-height:1.55;">
                    This is an automated email. Please do not reply.<br>
                    &copy; 2026 Holbox AI. All rights reserved.
                  </td>
                </tr>
              </table>
              <div style="text-align:center;margin-top:18px;font-size:11px;color:#94a3b8;">
                People &nbsp;&bull;&nbsp; Simpler Workplaces &nbsp;&bull;&nbsp; Brighter Tomorrow
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def signup_request_html(
    *,
    full_name: str,
    email: str,
    phone: str,
    department: str,
    designation: str,
) -> str:
    rows = (
        _detail_row("person", "Applicant name", full_name)
        + _detail_row("mail", "Work email", email, value_html=f'<a href="mailto:{_e(email)}" style="color:#2563eb;font-weight:700;text-decoration:none;">{_e(email)}</a>')
        + _detail_row("phone", "Phone number", phone)
        + _detail_row("dept", "Department", department)
        + _detail_row("briefcase", "Desired role", designation, last=True)
    )
    inner = f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;">
              Holbox HRMS &nbsp;&bull;&nbsp; New Employee Application
            </div>
            <h1 style="margin:10px 0 6px 0;font-size:28px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">
              Candidate Wants to Join
            </h1>
            <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5;">
              {_e(full_name)} has submitted an application and is waiting for your approval.
            </p>
          </td>
          <td valign="top" align="right" width="190">
            <div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;">
              <div style="font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#0f172a;">Action required</div>
              <div style="font-size:12px;color:#64748b;margin-top:3px;">Review the application.</div>
            </div>
          </td>
        </tr>
      </table>

      <div style="margin:22px 0 16px 0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">Candidate Details</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        {rows}
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 22px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
        <tr>
          <td style="padding:16px 18px;">
            <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:4px;">Next Steps</div>
            <div style="font-size:13px;color:#475569;line-height:1.55;">
              Review the application and approve the employee from your dashboard.
              Once approved, their account will be active and they will be guided to enroll their face biometrics.
            </div>
          </td>
        </tr>
      </table>

      <div style="text-align:center;padding:4px 0 18px 0;">
        {_btn(f"{PORTAL}/people", "Review application &rarr;", bg="#2563eb")}
      </div>
    """
    return wrap(inner, title=f"Candidate Wants to Join — {full_name}")


def signup_approved_html(
    *,
    full_name: str,
    email: str,
    emp_code: str,
    admin_name: str,
    department: str,
    designation: str,
) -> str:
    rows = (
        _detail_row("person", "Employee", full_name)
        + _detail_row("badge", "Employee code", emp_code)
        + _detail_row("mail", "Work email", email, value_html=f'<a href="mailto:{_e(email)}" style="color:#2563eb;font-weight:700;text-decoration:none;">{_e(email)}</a>')
        + _detail_row("dept", "Department", department)
        + _detail_row("briefcase", "Role", designation)
        + _detail_row("check", "Approved by", admin_name, last=True)
    )
    inner = f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#16a34a;">
              Employee Approved
            </div>
            <h1 style="margin:10px 0 6px 0;font-size:28px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">
              Approved by {_e(admin_name)}
            </h1>
            <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5;">
              {_e(full_name)} is now part of the Holbox workforce and can sign in.
            </p>
          </td>
          <td valign="top" align="right" width="200">
            <div style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:12px 14px;text-align:left;">
              <div style="font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#16a34a;">Approved</div>
              <div style="font-size:12px;color:#166534;margin-top:3px;">Employee account is active.</div>
            </div>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
        <tr>
          <td valign="top" width="58%" style="padding-right:12px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;">Employee Details</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
              {rows}
            </table>
          </td>
          <td valign="top" width="42%" style="padding-left:12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;margin-bottom:14px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font-size:13px;font-weight:800;color:#166534;margin-bottom:6px;">What's next?</div>
                  <div style="font-size:13px;color:#166534;line-height:1.5;">
                    {_e(full_name)} can now sign in to the attendance system and proceed with face biometric enrollment.
                  </div>
                </td>
              </tr>
            </table>
            <div style="margin-bottom:10px;">{_btn(f"{PORTAL}/people/{emp_code}", "View employee profile &rarr;", bg="#059669")}</div>
            <div>{_btn(PORTAL, "Go to Admin Dashboard", bg="#ffffff", color="#0f172a", border="1px solid #e2e8f0")}</div>
          </td>
        </tr>
      </table>
      <div style="height:18px;"></div>
    """
    return wrap(inner, title=f"Approved by {admin_name} — {full_name}")


def leave_request_html(
    *,
    applicant_name: str,
    applicant_code: str,
    leave_type_name: str,
    days_badge_text: str,
    date_display: str,
    reason_text: str,
    approve_url: str,
    reject_url: str,
    doc_url: str | None = None,
) -> str:
    who = f"{applicant_name}  {applicant_code}".strip() if applicant_code else applicant_name
    rows = (
        _detail_row("person", "Requested by", who)
        + _detail_row("calendar", "Leave type", leave_type_name)
        + _detail_row(
            "clock",
            "Duration",
            days_badge_text,
            value_html=(
                f'<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;'
                f'font-weight:700;font-size:13px;padding:3px 10px;border-radius:9999px;">'
                f'{_e(days_badge_text)}</span>'
            ),
        )
        + _detail_row("calendar", "Scheduled date(s)", date_display, last=True)
    )
    reason_block = ""
    if reason_text:
        reason_block = f"""
      <div style="margin:16px 0 0 0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">Reason for leave</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border:1px solid #e2e8f0;border-radius:12px;">
        <tr>
          {_icon_cell("chat")}
          <td style="padding:14px 18px 14px 8px;font-size:15px;font-weight:600;color:#0f172a;font-style:italic;">
            &ldquo;{_e(reason_text)}&rdquo;
          </td>
        </tr>
      </table>
        """
    doc_block = ""
    if doc_url:
        doc_block = f"""
      <div style="text-align:center;margin:16px 0 0 0;">
        {_btn(doc_url, "View attached medical document", bg="#eff6ff", color="#1d4ed8", border="1px solid #bfdbfe")}
      </div>
        """
    inner = f"""
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;">
              Holbox HRMS &nbsp;&bull;&nbsp; Leave Request
            </div>
            <h1 style="margin:10px 0 6px 0;font-size:28px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">
              New Leave Request
            </h1>
            <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5;">
              {_e(applicant_name)} has requested time off and is waiting for your review.
            </p>
          </td>
          <td valign="top" align="right" width="210">
            <div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;text-align:left;">
              <div style="font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#0f172a;">Action required</div>
              <div style="font-size:12px;color:#64748b;margin-top:3px;">Please review and take action.</div>
            </div>
          </td>
        </tr>
      </table>

      <div style="margin:22px 0 8px 0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">Leave Details</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        {rows}
      </table>
      {reason_block}
      {doc_block}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 18px 0;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:10px;">{_btn(approve_url, "&#10003;&nbsp; Approve", bg="#10b981")}</td>
                <td style="padding-left:10px;">{_btn(reject_url, "&#10005;&nbsp; Reject", bg="#ef4444")}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    """
    return wrap(inner, title=f"New Leave Request — {applicant_name}")


_STATUS_STYLE = {
    "present": ("#16a34a", "#f0fdf4", "PRESENT"),
    "early": ("#16a34a", "#f0fdf4", "PRESENT"),
    "late": ("#d97706", "#fffbeb", "LATE"),
    "half_day": ("#d97706", "#fffbeb", "HALF DAY"),
    "absent": ("#dc2626", "#fef2f2", "ABSENT"),
    "on_leave": ("#2563eb", "#eff6ff", "ON LEAVE"),
    "leave": ("#2563eb", "#eff6ff", "ON LEAVE"),
}


def _status_badge(status: str, first_in: str) -> str:
    key = (status or "").lower().replace(" ", "_")
    if key in ("absent",) and first_in in ("—", "-", "", None):
        color, bg, label = "#64748b", "#f8fafc", "NOT MARKED"
    else:
        color, bg, label = _STATUS_STYLE.get(key, ("#64748b", "#f8fafc", (status or "NOT MARKED").upper().replace("_", " ")))
    return (
        f'<span style="display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;'
        f'font-weight:800;letter-spacing:0.4px;background:{bg};color:{color};">{label}</span>'
    )


def shift_summary_html(
    *,
    shift_name: str,
    shift_timing: str,
    shift_date_label: str,
    stats: dict,
    roster: list[dict],
) -> str:
    def metric(label: str, value: object, color: str) -> str:
        return f"""
          <td width="20%" align="center" style="padding:14px 6px;border-right:1px solid #f1f5f9;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#94a3b8;">{_e(label)}</div>
            <div style="font-size:26px;font-weight:800;color:{color};margin-top:4px;">{_e(value)}</div>
          </td>
        """

    rows_html = ""
    for r in roster:
        late_html = (
            f'<span style="color:#d97706;font-weight:700;">{_e(r.get("late_str") or "")}</span>'
            if (r.get("late_minutes") or 0) > 0
            else '<span style="color:#94a3b8;">On time</span>'
        )
        rows_html += f"""
          <tr>
            <td style="padding:11px 12px;border-bottom:1px solid #f1f5f9;font-weight:700;color:#0f172a;font-size:13px;">
              {_e(r.get("name"))} <span style="font-size:11px;font-family:ui-monospace,monospace;color:#94a3b8;font-weight:600;">({_e(r.get("code"))})</span>
            </td>
            <td style="padding:11px 12px;border-bottom:1px solid #f1f5f9;">{_status_badge(str(r.get("status") or ""), str(r.get("first_in") or "—"))}</td>
            <td style="padding:11px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#334155;">{_e(r.get("first_in") or "—")}</td>
            <td style="padding:11px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#334155;">{_e(r.get("last_out") or "—")}</td>
            <td style="padding:11px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;">{late_html}</td>
            <td style="padding:11px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">{_e(r.get("hours_str") or "—")}</td>
          </tr>
        """

    inner = f"""
      <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;">
        Holbox HRMS &nbsp;&bull;&nbsp; Daily Shift Attendance Summary
      </div>
      <h1 style="margin:10px 0 8px 0;font-size:26px;font-weight:800;letter-spacing:-0.4px;color:#0f172a;">
        {_e(shift_name)}
      </h1>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;">
        {_e(shift_date_label)} &nbsp;&bull;&nbsp; {_e(shift_timing)}
      </div>
      <p style="margin:0 0 18px 0;font-size:14px;color:#64748b;">
        Here's the attendance summary for today's shift.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;margin-bottom:18px;">
        <tr>
          {metric("Scheduled", stats.get("total", 0), "#0f172a")}
          {metric("Present", stats.get("present", 0), "#16a34a")}
          {metric("Late", stats.get("late", 0), "#d97706")}
          {metric("Absent", stats.get("absent", 0), "#dc2626")}
          {metric("On leave", stats.get("leave", 0), "#2563eb").replace("border-right:1px solid #f1f5f9;", "")}
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr style="background:#f8fafc;">
          <th align="left" style="padding:10px 12px;font-size:10px;letter-spacing:0.7px;text-transform:uppercase;color:#94a3b8;">Employee</th>
          <th align="left" style="padding:10px 12px;font-size:10px;letter-spacing:0.7px;text-transform:uppercase;color:#94a3b8;">Status</th>
          <th align="left" style="padding:10px 12px;font-size:10px;letter-spacing:0.7px;text-transform:uppercase;color:#94a3b8;">In</th>
          <th align="left" style="padding:10px 12px;font-size:10px;letter-spacing:0.7px;text-transform:uppercase;color:#94a3b8;">Out</th>
          <th align="left" style="padding:10px 12px;font-size:10px;letter-spacing:0.7px;text-transform:uppercase;color:#94a3b8;">Late (mins)</th>
          <th align="left" style="padding:10px 12px;font-size:10px;letter-spacing:0.7px;text-transform:uppercase;color:#94a3b8;">Hours</th>
        </tr>
        {rows_html}
      </table>

      <div style="text-align:center;padding:22px 0 12px 0;">
        {_btn(PORTAL, "View Full Dashboard &rarr;", bg="#2563eb")}
      </div>
    """
    return wrap(inner, title=f"Attendance Summary — {shift_name}", width=720)
