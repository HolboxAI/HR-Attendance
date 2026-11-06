#!/usr/bin/env python3
"""
Extract comprehensive attendance report directly from Slack channel messages
from October 1, 2026 to October 27, 2026 without modifying any database records.
"""

import csv
import json
import os
import re
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
START_DT = datetime(2026, 10, 1, 0, 0, 0, tzinfo=IST)
END_DT = datetime(2026, 10, 27, 23, 59, 59, tzinfo=IST)

SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
CHANNEL_ID = "C0BTUGZBNR0"
DATA_DIR = "/Users/krishsharma/Documents/boxcode-hrms/data"

# Employee mapping helpers (Historical BX <-> Live SM mappings)
# Live employees on EC2:
EMP_MAP = {
    "SM052": {"name": "Krish Sharma", "email": "krish@holbox.ai"},
    "SM108": {"name": "Dhruv", "email": "dhruv@holbox.ai"},
    "SM003": {"name": "Daxrajsinh Jadeja", "email": "daxrajsinh.jadeja@holbox.ai"},
    "SM022": {"name": "Susmit Kulkarni", "email": "susmit@holbox.ai"},
    "SM014": {"name": "Vishnu Nair", "email": "vishnu.nair@holbox.ai"},
    "SM002": {"name": "Om Chikhaliya", "email": "om.chikhaliya@holbox.ai"},
    "SM050": {"name": "Debjyoti Adhikary", "email": "debjyotictr@holbox.ai"},
    "SM023": {"name": "Shivam Pandey", "email": "shivam@holbox.ai"},
    "SM053": {"name": "Nikunj Khanchandani", "email": "nikunj@holbox.ai"},
    "SM046": {"name": "Himesh Mansukhani", "email": "himesh.ctr@holbox.ai"},
    "SM027": {"name": "Sheel Shah", "email": "sheel@holbox.ai"},
    "SM051": {"name": "Karan Chaudhary", "email": "karanctr@holbox.ai"},
    "SM054": {"name": "Ritesh Naik", "email": "ritesh.ctr@holbox.ai"},
    "SM055": {"name": "Leeneksh Dubey", "email": "leeneksh.ctr@holbox.ai"},
    "SM028": {"name": "Ashly David", "email": "ashly@holbox.ai"},
    "BX001": {"name": "Bhavya Bulani", "email": "bhavya@holbox.ai"},
    "BX002": {"name": "Yug Patel", "email": "yug.ctr@holbox.ai"},
}

# Name normalizer
NAME_TO_CODE = {
    "krish sharma": "SM052",
    "dhruv": "SM108",
    "daxrajsinh jadeja": "SM003",
    "dax": "SM003",
    "susmit kulkarni": "SM022",
    "susmit": "SM022",
    "vishnu nair": "SM014",
    "om chikhaliya": "SM002",
    "debjyoti adhikary": "SM050",
    "debjyoti das adhikary": "SM050",
    "shivam pandey": "SM023",
    "nikunj khanchandani": "SM053",
    "nikunj": "SM053",
    "himesh mansukhani": "SM046",
    "himesh": "SM046",
    "sheel shah": "SM027",
    "sheel": "SM027",
    "karan chaudhary": "SM051",
    "karan": "SM051",
    "ritesh naik": "SM054",
    "leeneksh dubey": "SM055",
    "ashly david": "SM028",
    "ashly": "SM028",
    "bhavya bulani": "BX001",
    "bhavya": "BX001",
    "yug patel": "BX002",
}

def fetch_slack_users():
    req = urllib.request.Request(
        "https://slack.com/api/users.list",
        headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
    
    users = {}
    for m in data.get("members", []):
        uid = m.get("id")
        prof = m.get("profile", {})
        real = prof.get("real_name") or m.get("real_name") or m.get("name") or ""
        disp = prof.get("display_name") or ""
        email = prof.get("email") or ""
        handle = m.get("name") or ""
        users[uid] = {
            "name": real,
            "disp": disp,
            "email": email,
            "handle": handle
        }
    return users


def fetch_all_messages():
    messages = []
    cursor = None
    oldest = str(START_DT.timestamp())
    latest = str(END_DT.timestamp())
    
    print(f"Fetching Slack messages from {START_DT.strftime('%Y-%m-%d')} to {END_DT.strftime('%Y-%m-%d')}...")
    
    while True:
        url = f"https://slack.com/api/conversations.history?channel={CHANNEL_ID}&oldest={oldest}&latest={latest}&limit=200"
        if cursor:
            url += f"&cursor={cursor}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"})
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
        
        if not data.get("ok"):
            print("Slack API error:", data.get("error"))
            break
            
        batch = data.get("messages", [])
        messages.extend(batch)
        print(f"  Fetched {len(batch)} messages (total {len(messages)})...")
        
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor or not batch:
            break
        time.sleep(0.25)
        
    # Sort chronologically (oldest first)
    messages.sort(key=lambda m: float(m.get("ts", 0)))
    return messages


def resolve_employee(raw_name="", raw_code="", user_id="", slack_users=None):
    """Normalize and resolve employee code and name, prioritizing name over historical codes."""
    if slack_users is None:
        slack_users = {}
        
    code = (raw_code or "").strip().upper()
    name = (raw_name or "").strip()
    
    # 1. If user_id provided and no name, get name from Slack directory
    if user_id and user_id in slack_users:
        uinfo = slack_users[user_id]
        uname = uinfo["name"] or uinfo["disp"] or uinfo["handle"]
        if not name:
            name = uname

    # 2. Try Name lookup first (handles code reassignments like BX001 -> SM052 for Krish Sharma)
    if name:
        clean_name = re.sub(r'[^a-zA-Z ]', '', name).lower().strip()
        for k, c in NAME_TO_CODE.items():
            if k == clean_name or clean_name.startswith(k) or k.startswith(clean_name):
                canonical_name = EMP_MAP[c]["name"] if c in EMP_MAP else name
                return c, canonical_name
            
    # 3. If code is known in live EMP_MAP
    if code in EMP_MAP:
        return code, EMP_MAP[code]["name"]
            
    # 4. Fallback to provided values
    return code, name


def parse_message(msg, slack_users):
    """Parse a single Slack message into structured event fields."""
    ts = float(msg.get("ts", 0))
    dt = datetime.fromtimestamp(ts, IST)
    date_str = dt.strftime("%Y-%m-%d")
    time_str = dt.strftime("%I:%M:%S %p")
    text = msg.get("text", "")
    msg_url = f"https://slack.com/archives/{CHANNEL_ID}/p{msg.get('ts', '').replace('.', '')}"
    
    # Initialize fields
    emp_code = ""
    emp_name = ""
    event_type = "Other"
    punch_time = ""
    details = ""
    slack_user_id = ""
    
    # Check for User mentions in text
    u_match = re.search(r'<@([A-Z0-9]+)>', text)
    if u_match:
        slack_user_id = u_match.group(1)

    # 1. Check-In (Late)
    m = re.search(r'Late Arrival:\s*([^()]+)\s*\(([^)]+)\)\s*clocked in at\s*([0-9:AMPMapm ]+)\s*\(([^)]+)\)\s*on\s*([0-9-]+)', text, re.S)
    if not m:
        m = re.search(r'Check-In \(Late Arrival\).*?<@([A-Z0-9]+)>.*?clocked in at \*([^*]+)\*.*?⚠️ \*([^*]+)\*', text, re.S)
        if m:
            slack_user_id = m.group(1)
            punch_time = m.group(2).strip()
            details = m.group(3).strip()
            event_type = "Late Check-In"
            c, n = resolve_employee(user_id=slack_user_id, slack_users=slack_users)
            emp_code, emp_name = c, n
    else:
        raw_name, raw_code, punch_time, late_dur, shift_date = m.groups()
        punch_time = punch_time.strip()
        details = late_dur.strip()
        event_type = "Late Check-In"
        emp_code, emp_name = resolve_employee(raw_name, raw_code, slack_user_id, slack_users)

    # 2. Check-In (On-Time)
    if event_type == "Other":
        m = re.search(r'Check-In:\s*([^()]+)\s*\(([^)]+)\)\s*clocked in at\s*([0-9:AMPMapm ]+)(?:\s*\(([^)]+)\))?\s*on\s*([0-9-]+)', text, re.S)
        if m:
            raw_name, raw_code, punch_time, extra, shift_date = m.groups()
            punch_time = punch_time.strip()
            details = extra.strip() if extra else "On-time"
            event_type = "Check-In"
            emp_code, emp_name = resolve_employee(raw_name, raw_code, slack_user_id, slack_users)

    # 3. Check-Out
    if event_type == "Other":
        m = re.search(r'Check-Out:\s*([^()]+)\s*\(([^)]+)\)\s*clocked out at\s*([0-9:AMPMapm ]+)(?:\s*\(([^)]+)\))?\s*on\s*([0-9-]+)', text, re.S)
        if m:
            raw_name, raw_code, punch_time, work_dur, shift_date = m.groups()
            punch_time = punch_time.strip()
            details = work_dur.strip() if work_dur else ""
            event_type = "Check-Out"
            emp_code, emp_name = resolve_employee(raw_name, raw_code, slack_user_id, slack_users)

    # 4. Early Leave
    if event_type == "Other":
        m = re.search(r'Early (?:Departure|Leave):\s*\*?([^*]+?)\*?\s*left early at\s*\*?([0-9:AMPMapm ]+)\*?\s*(?:\(([^)]+)\))?', text, re.S)
        if m:
            raw_name, punch_time, early_dur = m.groups()
            punch_time = punch_time.strip()
            details = early_dur.strip() if early_dur else ""
            event_type = "Early Check-Out"
            emp_code, emp_name = resolve_employee(raw_name, "", slack_user_id, slack_users)

    # 5. Break Started
    if event_type == "Other":
        m = re.search(r'Break Started:\s*([^()]+)\s*\(([^)]+)\)\s*clocked out for a break at\s*([0-9:AMPMapm ]+)', text, re.S)
        if m:
            raw_name, raw_code, punch_time = m.groups()
            punch_time = punch_time.strip()
            event_type = "Break Started"
            emp_code, emp_name = resolve_employee(raw_name, raw_code, slack_user_id, slack_users)

    # 6. Break Completed
    if event_type == "Other":
        m = re.search(r'Break Completed:\s*([^()]+)\s*\(([^)]+)\)\s*returned from break at\s*([0-9:AMPMapm ]+)\s*(?:\(([^)]+)\))?', text, re.S)
        if m:
            raw_name, raw_code, punch_time, break_dur = m.groups()
            punch_time = punch_time.strip()
            details = break_dur.strip() if break_dur else ""
            event_type = "Break Completed"
            emp_code, emp_name = resolve_employee(raw_name, raw_code, slack_user_id, slack_users)

    # 7. Grace Period Expired (Absent Alert)
    if event_type == "Other":
        m = re.search(r'Grace Period Expired.*?<@([A-Z0-9]+)>.*?Hey\s*([^,]+),\s*your shift started at\s*\*([^*]+)\*', text, re.S)
        if m:
            uid, raw_name, shift_start = m.groups()
            slack_user_id = uid
            event_type = "Grace Period Expired (Absent Alert)"
            details = f"Shift started at {shift_start.strip()}, grace period expired"
            emp_code, emp_name = resolve_employee(raw_name, "", slack_user_id, slack_users)
        else:
            m2 = re.search(r'Grace Period Expired.*?\*([^*]+)\*\s*Hey\s*([^,]+),\s*your shift started at\s*\*([^*]+)\*', text, re.S)
            if m2:
                _, raw_name, shift_start = m2.groups()
                event_type = "Grace Period Expired (Absent Alert)"
                details = f"Shift started at {shift_start.strip()}, grace period expired"
                emp_code, emp_name = resolve_employee(raw_name, "", slack_user_id, slack_users)

    # 8. Shift End Checkout Reminder
    if event_type == "Other":
        m = re.search(r'Check out:.*?(?:<@([A-Z0-9]+)>|\*([^*]+)\*).*?shift ends at\s*([0-9:AMPMapm ]+)', text, re.S)
        if m:
            uid, raw_name, shift_end = m.groups()
            slack_user_id = uid or ""
            event_type = "Shift End Checkout Reminder"
            details = f"Shift ended at {shift_end.strip()}"
            emp_code, emp_name = resolve_employee(raw_name or "", "", slack_user_id, slack_users)

    # 9. Missing Checkout Warning
    if event_type == "Other":
        m = re.search(r'(?:<@([A-Z0-9]+)>|\*([^*]+)\*).*?attendance hasn\'t been marked as present because you haven\'t checked out', text, re.S)
        if m:
            uid, raw_name = m.groups()
            slack_user_id = uid or ""
            event_type = "Missing Checkout Warning"
            details = "Unresolved checkout at EOD — marked absent unless regularised"
            emp_code, emp_name = resolve_employee(raw_name or "", "", slack_user_id, slack_users)

    # 10. Break 45m Reminder
    if event_type == "Other":
        m = re.search(r'Break Reminder:.*?<@([A-Z0-9]+)>.*?on break for\s*([0-9]+)\s*minutes', text, re.S)
        if m:
            uid, mins = m.groups()
            slack_user_id = uid
            event_type = "Break Reminder (45m)"
            details = f"On break for {mins} minutes"
            emp_code, emp_name = resolve_employee("", "", slack_user_id, slack_users)

    # 11. Approvals / Regularisation
    if event_type == "Other":
        if "approved by" in text.lower() or "got approved" in text.lower():
            event_type = "Admin Approval / Regularisation"
            details = text.strip()
            m_app = re.search(r'([A-Za-z ]+)\s*(?:\(([^)]+)\))?\s*(?:got approved|approved)', text)
            if m_app:
                raw_name, raw_code = m_app.groups()
                emp_code, emp_name = resolve_employee(raw_name, raw_code or "", slack_user_id, slack_users)

    # 12. Summaries
    if event_type == "Other":
        if "Final summary for" in text:
            event_type = "Daily Final Summary"
            details = text.strip()
        elif "Shift Attendance Summary" in text:
            event_type = "Shift Summary"
            details = text.strip()

    # 13. Channel System Messages / Discussions
    if event_type == "Other":
        if "has joined the channel" in text:
            event_type = "User Joined Channel"
            details = text.strip()
            if slack_user_id:
                emp_code, emp_name = resolve_employee("", "", slack_user_id, slack_users)
        elif "Leave Request" in text:
            event_type = "Leave Request Notification"
            details = text.strip()
            m_lr = re.search(r'Leave Request from\s+([A-Za-z ]+)', text)
            if m_lr:
                emp_code, emp_name = resolve_employee(m_lr.group(1), "", "", slack_users)
        else:
            event_type = "Manual Channel Message"
            poster_uid = msg.get("user", "")
            if poster_uid:
                slack_user_id = poster_uid
                emp_code, emp_name = resolve_employee("", "", poster_uid, slack_users)
            details = text.strip()

    return {
        "timestamp_ist": dt.strftime("%Y-%m-%d %H:%M:%S"),
        "date": date_str,
        "time": time_str,
        "employee_code": emp_code,
        "employee_name": emp_name,
        "event_type": event_type,
        "event_time_claimed": punch_time,
        "duration_details": details,
        "raw_slack_text": text.replace("\r", " ").replace("\n", " ").strip(),
        "slack_user_id": slack_user_id,
        "slack_message_link": msg_url,
        "slack_ts": msg.get("ts", "")
    }


def parse_summary_blocks(messages):
    """
    Parse daily summaries and shift summaries to extract official reported status
    and scheduled employees per day.
    """
    # Key: (date_str, emp_code) -> dict of summary stats
    daily_summaries = {}

    for m in messages:
        text = m.get("text", "")
        ts = float(m.get("ts", 0))
        dt = datetime.fromtimestamp(ts, IST)
        
        # Check if message is a summary
        if "Final summary for" in text or "Shift Attendance Summary" in text:
            for b in m.get("blocks", []):
                sec_text = b.get("text", {}).get("text", "") if b.get("type") == "section" else ""
                if not sec_text:
                    continue
                
                # Check for group name
                group_match = re.search(r'\*([^*]+)\*\s*\(([0-9:AMPMapm –-]+)\)', sec_text)
                group_name = group_match.group(1).strip() if group_match else ""
                
                for line in sec_text.split("\n"):
                    # Match bullet: • Bhavya Bulani (`BX001`) — present · In 3:52 PM · Out 8:35 PM · Worked 4h 43m | Extra: *35m*
                    # or • Om Chikhaliya (`SM002`) — absent · In — · Out — · Worked 0m
                    b_match = re.search(r'•\s*([^`]+?)\s*\(`([^`]+)`\)\s*—\s*([a-zA-Z_]+)\s*·\s*In\s*([^·]+)\s*·\s*Out\s*([^·]+)\s*·\s*Worked\s*([^|\n]+)(?:\|\s*Extra:\s*\*?([^*]+)\*?)?', line)
                    if b_match:
                        raw_name, raw_code, status, in_time, out_time, worked, extra = b_match.groups()
                        c, n = resolve_employee(raw_name, raw_code)
                        date_str = dt.strftime("%Y-%m-%d")
                        
                        # Store in daily_summaries (Final summary overrides earlier shift summary)
                        key = (date_str, c)
                        daily_summaries[key] = {
                            "date": date_str,
                            "employee_code": c,
                            "employee_name": n,
                            "group": group_name,
                            "status": status.strip(),
                            "summary_in": in_time.strip(),
                            "summary_out": out_time.strip(),
                            "summary_worked": worked.strip(),
                            "summary_extra": extra.strip() if extra else ""
                        }
    return daily_summaries


def build_daily_report(events, daily_summaries):
    """
    Synthesize all individual Slack punch events and daily summaries into
    a comprehensive per-employee per-day attendance sheet.
    """
    # Group events by (date, employee_code)
    grouped = defaultdict(list)
    for ev in events:
        c = ev["employee_code"]
        d = ev["date"]
        if c:  # only track rows with identified employees
            grouped[(d, c)].append(ev)

    # Collect all unique dates and employees seen in either events or summaries
    all_keys = set(grouped.keys()).union(set(daily_summaries.keys()))
    
    daily_rows = []
    
    for (date_str, emp_code) in sorted(all_keys):
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        day_of_week = dt.strftime("%A")
        
        ev_list = grouped.get((date_str, emp_code), [])
        sum_info = daily_summaries.get((date_str, emp_code), {})
        
        emp_name = EMP_MAP.get(emp_code, {}).get("name", "")
        if not emp_name and ev_list:
            emp_name = ev_list[0]["employee_name"]
        if not emp_name and sum_info:
            emp_name = sum_info.get("employee_name", "")
            
        group = sum_info.get("group", "")
        
        # Analyze events
        first_in = ""
        last_out = ""
        is_late = "No"
        late_duration = ""
        breaks_count = 0
        break_durations = []
        worked_duration = sum_info.get("summary_worked", "")
        grace_alert = "No"
        missing_checkout_alert = "No"
        checkout_reminder = "No"
        event_types_seen = []
        
        # Chronological timeline string
        timeline_items = []
        
        for ev in ev_list:
            etype = ev["event_type"]
            event_types_seen.append(etype)
            etime = ev["event_time_claimed"] or ev["time"]
            
            if etype in ("Check-In", "Late Check-In"):
                if not first_in:
                    first_in = etype if not ev["event_time_claimed"] else ev["event_time_claimed"]
                if etype == "Late Check-In":
                    is_late = "Yes"
                    late_duration = ev["duration_details"]
                timeline_items.append(f"[{etime}] Check-In" + (f" ({late_duration})" if late_duration else ""))
                
            elif etype in ("Check-Out", "Early Check-Out"):
                last_out = etime
                if ev["duration_details"] and not worked_duration:
                    worked_duration = ev["duration_details"]
                timeline_items.append(f"[{etime}] Check-Out")
                
            elif etype == "Break Started":
                breaks_count += 1
                timeline_items.append(f"[{etime}] Break Start")
                
            elif etype == "Break Completed":
                if ev["duration_details"]:
                    break_durations.append(ev["duration_details"])
                timeline_items.append(f"[{etime}] Break End" + (f" ({ev['duration_details']})" if ev['duration_details'] else ""))
                
            elif "Grace Period Expired" in etype:
                grace_alert = "Yes"
                timeline_items.append(f"[{ev['time']}] Grace Expired Alert")
                
            elif "Missing Checkout" in etype:
                missing_checkout_alert = "Yes"
                timeline_items.append(f"[{ev['time']}] Missing Checkout Alert")
                
            elif "Checkout Reminder" in etype:
                checkout_reminder = "Yes"
                timeline_items.append(f"[{ev['time']}] Checkout Reminder")
                
            elif "Approval" in etype:
                timeline_items.append(f"[{ev['time']}] Approved")

        # Fallback to summary values if punch was only in summary
        if not first_in and sum_info.get("summary_in") and sum_info.get("summary_in") != "—":
            first_in = sum_info["summary_in"]
        if not last_out and sum_info.get("summary_out") and sum_info.get("summary_out") != "—":
            last_out = sum_info["summary_out"]
            
        # Overall status
        status = sum_info.get("status", "")
        if not status:
            if first_in and last_out:
                status = "Present"
            elif first_in and not last_out:
                status = "Missing Check-Out (Unresolved)" if missing_checkout_alert == "Yes" else "Incomplete (No Out)"
            elif grace_alert == "Yes":
                status = "Absent (Grace Expired)"
            elif breaks_count > 0:
                status = "Active"
            else:
                status = "Logged Event"
        else:
            status = status.capitalize()

        daily_rows.append({
            "Date": date_str,
            "Day_of_Week": day_of_week,
            "Employee_Code": emp_code,
            "Employee_Name": emp_name,
            "Shift_Group": group,
            "Slack_First_In": first_in or "—",
            "Slack_Last_Out": last_out or "—",
            "Reported_Status": status,
            "Is_Late": is_late,
            "Late_Duration": late_duration or "—",
            "Worked_Duration": worked_duration or "—",
            "Extra_Hours": sum_info.get("summary_extra", "—"),
            "Breaks_Count": breaks_count,
            "Break_Durations": "; ".join(break_durations) if break_durations else "—",
            "Grace_Period_Alert_Sent": grace_alert,
            "Missing_Checkout_Alert_Sent": missing_checkout_alert,
            "Checkout_Reminder_Sent": checkout_reminder,
            "Total_Slack_Events": len(ev_list),
            "Slack_Timeline": " -> ".join(timeline_items) if timeline_items else "(From Daily Summary Post)"
        })
        
    return daily_rows


def main():
    print("=== Extracting Complete Slack Attendance Data ===")
    slack_users = fetch_slack_users()
    print(f"Loaded {len(slack_users)} Slack users for tagging.")
    
    messages = fetch_all_messages()
    print(f"Loaded {len(messages)} total Slack messages from channel.")
    
    # 1. Parse individual events
    events = []
    for msg in messages:
        ev = parse_message(msg, slack_users)
        events.append(ev)
        
    print(f"Parsed {len(events)} individual event records.")
    
    # 2. Parse daily summaries
    daily_summaries = parse_summary_blocks(messages)
    print(f"Parsed {len(daily_summaries)} daily summary entries.")
    
    # 3. Build daily synthesized report
    daily_rows = build_daily_report(events, daily_summaries)
    print(f"Generated {len(daily_rows)} consolidated daily attendance records.")
    
    # Export 1: Raw All Events CSV
    events_csv_path = os.path.join(DATA_DIR, "Slack_Attendance_Events_2026-10-01_to_2026-10-27.csv")
    with open(events_csv_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "Timestamp_IST",
            "Date",
            "Time",
            "Employee_Code",
            "Employee_Name",
            "Event_Type",
            "Event_Time_Claimed",
            "Duration_Details",
            "Raw_Slack_Text",
            "Slack_User_ID",
            "Slack_Message_Link",
            "Slack_TS"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for ev in events:
            writer.writerow({
                "Timestamp_IST": ev["timestamp_ist"],
                "Date": ev["date"],
                "Time": ev["time"],
                "Employee_Code": ev["employee_code"],
                "Employee_Name": ev["employee_name"],
                "Event_Type": ev["event_type"],
                "Event_Time_Claimed": ev["event_time_claimed"],
                "Duration_Details": ev["duration_details"],
                "Raw_Slack_Text": ev["raw_slack_text"],
                "Slack_User_ID": ev["slack_user_id"],
                "Slack_Message_Link": ev["slack_message_link"],
                "Slack_TS": ev["slack_ts"]
            })
    print(f"Saved raw events log to: {events_csv_path}")
    
    # Export 2: Consolidated Daily Attendance Sheet CSV
    daily_csv_path = os.path.join(DATA_DIR, "Slack_Daily_Attendance_Summary_2026-10-01_to_2026-10-27.csv")
    with open(daily_csv_path, "w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "Date",
            "Day_of_Week",
            "Employee_Code",
            "Employee_Name",
            "Shift_Group",
            "Slack_First_In",
            "Slack_Last_Out",
            "Reported_Status",
            "Is_Late",
            "Late_Duration",
            "Worked_Duration",
            "Extra_Hours",
            "Breaks_Count",
            "Break_Durations",
            "Grace_Period_Alert_Sent",
            "Missing_Checkout_Alert_Sent",
            "Checkout_Reminder_Sent",
            "Total_Slack_Events",
            "Slack_Timeline"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in daily_rows:
            writer.writerow(row)
    print(f"Saved daily summary sheet to: {daily_csv_path}")

    # Summary statistics
    emp_event_counts = Counter(e["employee_name"] for e in events if e["employee_name"])
    print("\nTop Active Employees in Slack:")
    for name, cnt in emp_event_counts.most_common(10):
        print(f"  {name}: {cnt} events")


if __name__ == "__main__":
    from collections import Counter
    main()
