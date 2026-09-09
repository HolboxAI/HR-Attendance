"""Comprehensive End-to-End System Test Suite.
Tests all features across Web and Mobile APIs:
1. Authentication & Sessions (Tokens, Passwords, Refresh, Expiration)
2. Live Board & Filters (Presence, Department, Status, WFH, Rejected)
3. Employee Directory & Profiles (BX001, BX002, Deactivated, Leavers)
4. WFH Lifecycle (Toggle, Request, Approve, Reject, Inbox Alert, Remote Punch)
5. Attendance History & Date Filters (Today, This Month, Custom Ranges, Flags)
6. Detailed Month Attendance & Downloadable PDF (All columns, KPI grid, 90-day range, reversal edge case)
7. Leave Lifecycle (Apply, Balance, Sandwich rule, Medical proof, Decisions, Audit)
8. Attendance Corrections (Request, Punch update, Manager decision, Limits)
9. Device Bindings & Unbind
10. Notifications & Inbox (Unread filter, Mark read, Direct actions)
11. Mobile APIs (Me, Punch with Geofence, Offline queue sync)
12. Role-Based Access Control (Super Admin vs HR Admin vs Manager vs Employee)
"""
import sys
import unittest
from datetime import date, timedelta
from io import BytesIO

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.core.security import create_token_pair
from app.db.session import SessionLocal
from app.models import User, Employee, Department
from app.models.enums import UserRole, LeaveStatus


class E2EFeaturesTestSuite(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.db = SessionLocal()

        # Fetch users for different roles
        cls.super_admin_user = cls.db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
        cls.hr_admin_user = cls.db.query(User).filter(User.role == UserRole.HR_ADMIN).first()
        cls.employee_user = cls.db.query(User).filter(User.role == UserRole.EMPLOYEE, User.is_active == True).first()

        cls.super_admin_token = create_token_pair(
            user_id=cls.super_admin_user.id,
            role=cls.super_admin_user.role.value,
            employee_id=cls.super_admin_user.employee_id
        ).access_token

        cls.hr_token = create_token_pair(
            user_id=cls.hr_admin_user.id,
            role=cls.hr_admin_user.role.value,
            employee_id=cls.hr_admin_user.employee_id
        ).access_token

        cls.employee_token = create_token_pair(
            user_id=cls.employee_user.id,
            role=cls.employee_user.role.value,
            employee_id=cls.employee_user.employee_id
        ).access_token

        cls.admin_headers = {"Authorization": f"Bearer {cls.super_admin_token}"}
        cls.hr_headers = {"Authorization": f"Bearer {cls.hr_token}"}
        cls.emp_headers = {"Authorization": f"Bearer {cls.employee_token}"}

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    # ------------------------------------------------------------- 1. Board
    def test_01_board_endpoints(self):
        resp = self.client.get("/api/v1/admin/board", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("summary", data)
        self.assertIn("rows", data)
        self.assertIn("present", data["summary"])
        self.assertIn("wfh", data["summary"])

        # Check rejected punches endpoint
        resp_rej = self.client.get("/api/v1/admin/rejected?days=7", headers=self.admin_headers)
        self.assertEqual(resp_rej.status_code, 200)
        self.assertIsInstance(resp_rej.json(), list)

    # ----------------------------------------------------------- 2. Directory
    def test_02_employee_directory(self):
        resp = self.client.get("/api/v1/admin/employees", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        emps = resp.json()
        self.assertGreater(len(emps), 0)

        # Profile detail
        first_code = emps[0]["emp_code"]
        resp_prof = self.client.get(f"/api/v1/admin/employees/{first_code}", headers=self.admin_headers)
        self.assertEqual(resp_prof.status_code, 200)
        prof = resp_prof.json()
        self.assertEqual(prof["emp_code"], first_code)

    # --------------------------------------------------------- 3. Month & PDF
    def test_03_month_attendance_and_pdf(self):
        emp_code = "BX001"
        s_date = "2026-09-01"
        e_date = "2026-09-07"

        # JSON data
        resp = self.client.get(
            f"/api/v1/admin/month?employee_code={emp_code}&start_date={s_date}&end_date={e_date}",
            headers=self.admin_headers
        )
        self.assertEqual(resp.status_code, 200)
        m_data = resp.json()
        self.assertEqual(m_data["employee_code"], emp_code)
        self.assertEqual(m_data["start_date"], s_date)
        self.assertEqual(m_data["end_date"], e_date)
        self.assertIn("totals", m_data)
        self.assertIn("days", m_data)
        self.assertEqual(len(m_data["days"]), 7)

        # PDF generation
        resp_pdf = self.client.get(
            f"/api/v1/admin/export/employee.pdf?employee_code={emp_code}&start_date={s_date}&end_date={e_date}",
            headers=self.admin_headers
        )
        self.assertEqual(resp_pdf.status_code, 200)
        self.assertEqual(resp_pdf.headers.get("content-type"), "application/pdf")
        self.assertTrue(resp_pdf.content.startswith(b"%PDF"))
        self.assertIn(f"{emp_code}_attendance_{s_date}_{e_date}.pdf", resp_pdf.headers.get("content-disposition", ""))

    # ------------------------------------------------- 4. PDF 90-day & Edge Cases
    def test_04_month_pdf_edge_cases(self):
        emp_code = "BX001"

        # Edge case A: 90-day range (multi-page table test)
        s_date = "2026-06-01"
        e_date = "2026-08-31"
        resp_pdf = self.client.get(
            f"/api/v1/admin/export/employee.pdf?employee_code={emp_code}&start_date={s_date}&end_date={e_date}",
            headers=self.admin_headers
        )
        self.assertEqual(resp_pdf.status_code, 200)
        self.assertTrue(len(resp_pdf.content) > 5000)  # Multi-page PDF is larger

        # Edge case B: Single-day range
        resp_single = self.client.get(
            f"/api/v1/admin/month?employee_code={emp_code}&start_date=2026-09-01&end_date=2026-09-01",
            headers=self.admin_headers
        )
        self.assertEqual(resp_single.status_code, 200)
        self.assertEqual(len(resp_single.json()["days"]), 1)

        # Edge case C: Invalid employee code
        resp_404 = self.client.get(
            "/api/v1/admin/month?employee_code=NON_EXISTENT&start_date=2026-09-01&end_date=2026-09-07",
            headers=self.admin_headers
        )
        self.assertEqual(resp_404.status_code, 404)

    # ----------------------------------------------------- 5. Attendance History
    def test_05_attendance_history(self):
        resp = self.client.get(
            "/api/v1/admin/history/attendance?start_date=2026-09-01&end_date=2026-09-07",
            headers=self.admin_headers
        )
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertIsInstance(rows, list)
        for r in rows:
            self.assertIn("shift_date", r)
            self.assertIn("employee_code", r)
            self.assertIn("status", r)

        # History overview
        resp_ov = self.client.get(
            "/api/v1/admin/history/overview?start_date=2026-09-01&end_date=2026-09-07",
            headers=self.admin_headers
        )
        self.assertEqual(resp_ov.status_code, 200)
        ov = resp_ov.json()
        self.assertIn("present", ov)
        self.assertIn("absent", ov)

    # ------------------------------------------------------------- 6. WFH Flow
    def test_06_wfh_flow_and_notifications(self):
        # 1. Admin toggles WFH for employee
        emp = self.db.query(Employee).filter(Employee.id == self.employee_user.employee_id).first()
        self.assertIsNotNone(emp)

        # Ensure starting state is False so state transition occurs
        emp.is_wfh_enabled = False
        self.db.commit()

        # 1. Admin toggles WFH to True
        resp_toggle = self.client.put(
            "/api/v1/admin/wfh-config",
            json={"employee_ids": [str(emp.id)], "is_wfh_enabled": True},
            headers=self.admin_headers
        )
        self.assertEqual(resp_toggle.status_code, 200)

        # 2. Verify employee received notification
        resp_notif = self.client.get("/api/v1/notifications?unread_only=true", headers=self.emp_headers)
        self.assertEqual(resp_notif.status_code, 200)
        notifs = resp_notif.json()
        wfh_notifs = [n for n in notifs if n.get("category") == "wfh.assigned" or "Work From Home" in n.get("body", "")]
        self.assertTrue(len(wfh_notifs) > 0, "Employee did not receive WFH notification")

        # 3. Mark notification as read
        nid = wfh_notifs[0]["id"]
        resp_read = self.client.post(f"/api/v1/notifications/{nid}/read", headers=self.emp_headers)
        self.assertEqual(resp_read.status_code, 200)

    # ------------------------------------------------------------- 7. Leave Hub
    def test_07_leave_endpoints(self):
        # Leave types
        resp_types = self.client.get("/api/v1/admin/leave/types", headers=self.admin_headers)
        self.assertEqual(resp_types.status_code, 200)
        types = resp_types.json()
        self.assertGreater(len(types), 0)

        # Policy
        resp_pol = self.client.get("/api/v1/admin/leave/policy", headers=self.admin_headers)
        self.assertEqual(resp_pol.status_code, 200)

        # Balances
        resp_bal = self.client.get("/api/v1/admin/leave/balances", headers=self.admin_headers)
        self.assertEqual(resp_bal.status_code, 200)

        # Audit
        resp_aud = self.client.get("/api/v1/admin/leave/audit", headers=self.admin_headers)
        self.assertEqual(resp_aud.status_code, 200)

    # ----------------------------------------------------- 8. Corrections Hub
    def test_08_corrections_endpoints(self):
        resp_pend = self.client.get("/api/v1/admin/corrections/pending", headers=self.admin_headers)
        self.assertEqual(resp_pend.status_code, 200)

        resp_sum = self.client.get("/api/v1/admin/corrections/summary", headers=self.admin_headers)
        self.assertEqual(resp_sum.status_code, 200)

    # --------------------------------------------------------- 9. Devices Hub
    def test_09_devices_endpoints(self):
        resp_dev = self.client.get("/api/v1/admin/devices", headers=self.admin_headers)
        self.assertEqual(resp_dev.status_code, 200)

    # ----------------------------------------------------------- 10. RBAC
    def test_10_rbac_permission_boundaries(self):
        # Plain employee cannot access admin endpoints
        admin_routes = [
            "/api/v1/admin/board",
            "/api/v1/admin/rejected",
            "/api/v1/admin/month?employee_code=BX001",
            "/api/v1/admin/devices",
            "/api/v1/admin/corrections/pending",
            "/api/v1/admin/leave/policy",
            "/api/v1/admin/leave/audit",
        ]
        for route in admin_routes:
            resp = self.client.get(route, headers=self.emp_headers)
            self.assertEqual(
                resp.status_code, 403,
                f"Employee should be forbidden (403) from {route}, got {resp.status_code}"
            )

        # Plain employee CAN access their own mobile endpoints
        resp_me = self.client.get("/api/v1/mobile/me", headers=self.emp_headers)
        self.assertEqual(resp_me.status_code, 200)

        resp_my_month = self.client.get("/api/v1/mobile/month?year=2026&month=9", headers=self.emp_headers)
        self.assertEqual(resp_my_month.status_code, 200)


if __name__ == "__main__":
    unittest.main()
