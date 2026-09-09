"""Live HTTP Edge Case Verification against EC2 (http://98.84.138.15).

Tests all Phase 5 edge cases against the live running API:
1. Authentication & Session Handshake
2. Leave Categories & Reason Validation
3. Shift Templates Hub (CRUD with HH:MM Timings)
4. Organization-Wide Default Shift & Deletion Protection
5. Deterministic 4-Tier Hierarchy (Direct Override > Group > Default)
6. 1-Click Email Decision Endpoint (/leave/email-decide)
7. Password Change Security Validation Rules
8. Web Dashboard Core Routes
"""

import json
import urllib.request
import urllib.error
import uuid
import sys

BASE_URL = "http://98.84.138.15"
API_URL = f"{BASE_URL}/api/v1"

passed = 0
failed = 0

def log_test(name: str, success: bool, extra: str = ""):
    global passed, failed
    if success:
        print(f"  ✓ PASS: {name} {extra}")
        passed += 1
    else:
        print(f"  ✗ FAIL: {name} {extra}")
        failed += 1

def api_request(path: str, method: str = "GET", data: dict = None, token: str = None) -> tuple[int, dict | list | str]:
    url = f"{API_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(content)
            except Exception:
                return resp.status, content
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        try:
            return e.code, json.loads(content)
        except Exception:
            return e.code, content
    except Exception as e:
        return 0, str(e)


def main():
    print("================================================================")
    print("PHASE 5 LIVE EDGE CASES VERIFICATION — EC2 (98.84.138.15)")
    print("================================================================\n")

    # -------------------------------------------------------------------------
    # TEST 1: Authentication
    # -------------------------------------------------------------------------
    print("--- [1/8] Authentication & Session Handshake ---")
    status, res = api_request("/auth/login", method="POST", data={
        "email": "krish@boxcode.ai",
        "password": "opal-rhubarb-saffron-21"
    })
    token = res.get("access_token") if isinstance(res, dict) else None
    log_test("Admin Login (200 OK + JWT)", status == 200 and token is not None)
    if not token:
        print("Cannot continue without token.")
        return

    # -------------------------------------------------------------------------
    # TEST 2: Leave Reason Categories
    # -------------------------------------------------------------------------
    print("\n--- [2/8] Feature 21: Leave Categories & Reason Validation ---")
    status, res = api_request("/leave/categories", token=token)
    expected_categories = {
        "Personal", "Family emergency", "Medical/health-related",
        "Family/household responsibility", "Other legitimate personal reason"
    }
    actual_categories = set(res) if isinstance(res, list) else set()
    log_test("All 5 Official PRD Leave Categories Returned", status == 200 and actual_categories == expected_categories, f"({len(actual_categories)} categories)")

    # -------------------------------------------------------------------------
    # TEST 3: Shift Management Hub - Listing & Creating Shifts
    # -------------------------------------------------------------------------
    print("\n--- [3/8] Feature 22: Shift Templates Hub (CRUD) ---")
    status, res = api_request("/admin/shifts", token=token)
    shifts = res.get("shifts", []) if isinstance(res, dict) else []
    log_test("List Shift Templates", status == 200 and len(shifts) > 0, f"({len(shifts)} shifts existing)")

    # Create temporary shift template with unique name (e.g. Interns 3 PM - 8 PM)
    unique_suffix = uuid.uuid4().hex[:6]
    shift_data = {
        "name": f"Live Test Shift {unique_suffix}",
        "start_time": "15:00",
        "end_time": "20:00",
        "break_minutes": 30,
        "grace_minutes": 15,
        "cutover_hour": 5,
        "working_days": [0, 1, 2, 3, 4, 5]
    }
    status, created_shift = api_request("/admin/shifts", method="POST", data=shift_data, token=token)
    shift_id = created_shift.get("id") if isinstance(created_shift, dict) else None
    log_test("Create Custom Timing Shift Template (3PM - 8PM)", status in (200, 201) and shift_id is not None, f"(ID: {shift_id})")

    # -------------------------------------------------------------------------
    # TEST 4: Organization-Wide Default Shift & Deletion Protection
    # -------------------------------------------------------------------------
    print("\n--- [4/8] Feature 23: Organization-Wide Default Shift & Protection ---")
    orig_default_id = res.get("default_shift_template_id")
    if not orig_default_id and shifts:
        orig_default_id = shifts[0]["id"]
    
    # Set created shift as default
    status, res_def = api_request("/admin/shifts/default", method="PUT", data={"shift_template_id": shift_id}, token=token)
    log_test("Set Organization-Wide Default Shift", status == 200)

    # Edge Case: Attempt to delete the Organization Default Shift -> MUST BE REJECTED
    status, res_del = api_request(f"/admin/shifts/{shift_id}", method="DELETE", token=token)
    log_test("EDGE CASE: Deleting Default Shift is BLOCKED", status in (400, 409), f"(Rejected with HTTP {status}: {res_del.get('detail') if isinstance(res_del, dict) else res_del})")

    # Revert back to original default
    api_request("/admin/shifts/default", method="PUT", data={"shift_template_id": orig_default_id}, token=token)

    # -------------------------------------------------------------------------
    # TEST 5: Deterministic Shift Hierarchy (Direct Override > Group > Default)
    # -------------------------------------------------------------------------
    print("\n--- [5/8] Features 24 & 25: Deterministic 4-Tier Hierarchy ---")
    status, roster = api_request("/admin/shifts/roster", token=token)
    test_emp = next((r for r in roster if r.get("emp_code") == "BX002"), roster[0])
    emp_id = test_emp["employee_id"]

    # Step A: Create Shift Group
    group_data = {
        "name": f"Live Test Squad {unique_suffix}",
        "description": "Verification Group",
        "shift_template_id": shift_id,
        "employee_ids": [emp_id]
    }
    status, created_group = api_request("/admin/shifts/groups", method="POST", data=group_data, token=token)
    group_id = created_group.get("id") if isinstance(created_group, dict) else None
    log_test("Create Shift Group with Employee Member", status in (200, 201) and group_id is not None)

    # Verify Roster resolves to Group
    status, roster = api_request("/admin/shifts/roster", token=token)
    emp_roster = next((r for r in roster if r["employee_id"] == emp_id), None)
    log_test("Level 2 Resolution: Employee resolves to GROUP shift", emp_roster and emp_roster.get("source") == "group", f"(Source: {emp_roster.get('source')}, Shift: {emp_roster.get('effective_shift_name')})")

    # Step B: Apply Direct Shift Assignment Override (Night Shift)
    night_shift = next((s for s in shifts if "Night" in s["name"]), None)
    night_shift_id = night_shift["id"] if night_shift else shift_id
    assign_data = {
        "employee_id": emp_id,
        "shift_template_id": night_shift_id,
        "effective_from": "2026-09-01",
        "effective_to": "2026-09-30"
    }
    status, res_ov = api_request("/admin/shifts/assign", method="POST", data=assign_data, token=token)
    log_test("Create Direct Shift Assignment Override", status in (200, 201))

    # Verify Roster resolves to Direct Override (Overriding the Group!)
    status, roster = api_request("/admin/shifts/roster", token=token)
    emp_roster = next((r for r in roster if r["employee_id"] == emp_id), None)
    log_test("Level 1 Resolution: DIRECT OVERRIDE takes precedence over Group", emp_roster and emp_roster.get("source") == "direct", f"(Source: {emp_roster.get('source')}, Shift: {emp_roster.get('effective_shift_name')})")

    # Step C: Remove Direct Override -> MUST fall back to Group Shift
    status, res_clear = api_request(f"/admin/shifts/assign/{emp_id}", method="DELETE", token=token)
    log_test("Clear Direct Override", status == 200)

    status, roster = api_request("/admin/shifts/roster", token=token)
    emp_roster = next((r for r in roster if r["employee_id"] == emp_id), None)
    log_test("EDGE CASE: Employee immediately reverts to GROUP shift (not default)", emp_roster and emp_roster.get("source") == "group", f"(Source: {emp_roster.get('source')})")

    # Step D: Delete Shift Group -> Employee reverts to Organization Default
    status, res_grp_del = api_request(f"/admin/shifts/groups/{group_id}", method="DELETE", token=token)
    log_test("Delete Shift Group", status == 200)

    status, roster = api_request("/admin/shifts/roster", token=token)
    emp_roster = next((r for r in roster if r["employee_id"] == emp_id), None)
    log_test("EDGE CASE: Employee immediately reverts to DEFAULT shift", emp_roster and emp_roster.get("source") == "default", f"(Source: {emp_roster.get('source')})")

    # Clean up test shift
    api_request(f"/admin/shifts/{shift_id}", method="DELETE", token=token)

    # -------------------------------------------------------------------------
    # TEST 6: 1-Click Email Decision URL Verification
    # -------------------------------------------------------------------------
    print("\n--- [6/8] Feature: 1-Click Email Decision URL ---")
    req = urllib.request.Request(f"{API_URL}/leave/email-decide?token=invalid.token.here")
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code
        content = e.read().decode("utf-8")
    log_test("Email Decision Endpoint handles invalid token with 400 HTML page", status == 400 and "Link Expired" in content)

    # -------------------------------------------------------------------------
    # TEST 7: Password Security Rules
    # -------------------------------------------------------------------------
    print("\n--- [7/8] Feature: Password Change Validation Rules ---")
    # Attempt too short password (< 10 chars)
    status, res_short = api_request("/auth/set-password", method="POST", data={
        "current_password": "opal-rhubarb-saffron-21",
        "new_password": "short"
    }, token=token)
    log_test("EDGE CASE: Password < 10 chars is REJECTED", status in (400, 422), f"(HTTP {status})")

    # Attempt identical password
    status, res_same = api_request("/auth/set-password", method="POST", data={
        "current_password": "opal-rhubarb-saffron-21",
        "new_password": "opal-rhubarb-saffron-21"
    }, token=token)
    log_test("EDGE CASE: Identical new password is REJECTED", status in (400, 422), f"(HTTP {status})")

    # Attempt wrong current password
    status, res_wrong = api_request("/auth/set-password", method="POST", data={
        "current_password": "wrong-current-password-123",
        "new_password": "brand-new-secure-password-2026"
    }, token=token)
    log_test("EDGE CASE: Incorrect current password is REJECTED", status == 401, f"(HTTP {status})")

    # -------------------------------------------------------------------------
    # TEST 8: Live Web Route Status Checks
    # -------------------------------------------------------------------------
    print("\n--- [8/8] Web Dashboard Core Routes (HTTP 200) ---")
    routes = [
        ("/login", 200),
        ("/api/v1/health", 200),
        ("/docs", 200),
    ]
    for r, exp in routes:
        req = urllib.request.Request(f"{BASE_URL}{r}")
        try:
            with urllib.request.urlopen(req) as resp:
                st = resp.status
        except urllib.error.HTTPError as e:
            st = e.code
        except Exception:
            st = 0
        log_test(f"Route '{r}' returns HTTP {exp}", st == exp, f"(Got {st})")

    print("\n================================================================")
    print(f"FINAL RESULT: {passed} PASSED, {failed} FAILED out of {passed + failed} tests.")
    print("================================================================")

if __name__ == "__main__":
    main()
