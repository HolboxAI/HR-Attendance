PRODUCT REQUIREMENTS DOCUMENT (PRD)
Attendance, Leave, WFH, Corrections & Workforce Management Enhancements

Document Type: Product Requirements Document
Product: Existing Employee Attendance & Leave Management System
Status: Proposed Enhancement
Implementation Strategy: Incremental, five features per phase

1. PRODUCT OBJECTIVE

Extend the existing working attendance and leave management system without replacing its current architecture or functionality. The enhancements cover leave workflows, medical leave, attendance corrections, historical attendance, WFH/GPS verification, leave-reason validation, and shift management.

The system should provide administrators with stronger control, traceability, historical visibility, and workforce configuration while providing employees with clear, controlled self-service workflows.

2. USER ROLES

Admin:
- Approve/reject/partially approve requests.
- Review medical documents.
- Configure WFH employees and shifts.
- View attendance history, corrections, exceptions, and WFH information.
- Configure correction limits and workforce settings.
- View audit information and authorized employee location data.

Employee:
- Apply for leave.
- Select approved leave-reason categories and provide details.
- Submit medical documentation when required.
- Request attendance corrections.
- Request temporary WFH.
- Check in remotely when WFH is approved/configured.
- View personal request and attendance status.

3. LEAVE MANAGEMENT

3.1 Email Leave Approval/Rejection
- Send admins an email when a leave request is submitted.
- Include employee, leave type, dates, reason, document status, and current status.
- Provide authorized Approve and Reject actions.
- Email actions must update the same request used by the application.
- Prevent unauthorized, duplicate, or conflicting actions.
- Record actor, timestamp, previous status, and new status.

3.2 Dedicated Leave Status Page
Create a separate Leave Status page.
Display:
- Employee
- Leave type
- Requested dates
- Reason
- Current status
- Submitted time
- Last status update
- Updated by
- Supporting documents
- Admin comments

Supported statuses:
- Pending
- Approved
- Rejected
- Partially Approved

Maintain a status timeline for every request.

3.3 Pending Status
New leave requests should follow:
Submitted -> Pending

Possible subsequent transitions:
Pending -> Approved
Pending -> Rejected
Pending -> Partially Approved

Status must remain consistent across employee UI, admin UI, dashboard, email, notifications, and history.

3.4 Medical Leave & Partial Approval
For medical leave, an admin can partially approve a request while requiring medical documentation.
Track:
- Partial approval
- Documentation required
- Documentation deadline
- Document submission
- Final decision

Default documentation deadline: 3 days.

3.5 Medical Documentation Outcome
If documentation is submitted:
- Store and associate the document with the leave request.
- Allow admin review.
- Allow final approval/rejection.

If documentation is not submitted within the deadline:
- Mark the relevant attendance as Absent according to policy.
- Record an explicit absence reason such as “Medical documentation not submitted within required timeframe.”
- Preserve the original leave/request lifecycle for audit.

4. ATTENDANCE CORRECTIONS

4.1 Predefined Correction Reasons
Employees requesting attendance correction must select a predefined category before adding details.

Initial defaults:
1. Phone/device battery died
2. Emergency
3. Network/connectivity issue
4. Forgot to punch
5. Device/application issue

Store the selected category separately from the employee’s explanation.

4.2 Correction Limits
- Default correction limit: 5.
- Admin can increase the limit.
- Maximum: 15.
- The limit is an overall employee/policy limit, not a separate allowance per reason.
- Block new requests after the configured limit is reached.
- Show the employee a clear explanation when blocked.

4.3 Correction Management Page
Enhance the existing Correction page with:
- Pending/waiting-for-decision section.
- Employee correction summary list.
- Existing Direct Entry functionality below/within the current page flow.

Employee list should show:
- Employee name
- Corrections used
- Correction limit
- Status

Clicking an expandable arrow should open a compact detail panel showing each correction, including date, reason, explanation, status, and admin decision.

4.4 Correction-Based Attendance
If attendance becomes Present because a correction was approved, preserve that provenance.
Display a secondary indicator such as:
Present — Corrected

5. HISTORY & ANALYTICS

5.1 Attendance History
Add Attendance History to the left sidebar.
Admin can select any employee and open a dedicated employee attendance history page.

Show:
- Present
- Absent
- Medical/sick leave
- Other leave
- WFH
- Correction-based Present
- Late
- Other applicable attendance states

5.2 Flexible History Date Range
Provide calendar/date filtering.
Support:
- Last 10 days
- Last 15 days
- Last month
- Custom date range

5.3 Attendance Visual Indicators
Use consistent visual indicators for:
- Present
- Absent
- Leave
- Medical leave
- WFH
- Correction-based Present
- Late

Display a legend so the meaning of each indicator is always clear.

5.4 Centralized History Overview
Add a History section to the sidebar with cards for historical datasets such as:
- Present Employees
- Absent Employees
- Leave
- SL
- EL
- CL
- Overall Leave
- Corrections
- Exceptions
- WFH
- Late Attendance
- Other applicable dashboard metrics

Clicking a card opens its detailed history.

5.5 Interactive History Pie Chart
Add an interactive pie chart for historical attendance/workforce distribution.
Hover should show category, count, percentage, and relevant summary.
Clicking a segment must navigate/open the detailed history for that category.
The chart must be interactive, not just a static overview.

5.6 Employee History Detail
When an employee is selected:
- Show employee information, current shift, and WFH status.
- Show daily attendance for the selected date range.
- Show status, time, source, and reason.
- Clearly identify WFH and correction-based attendance.

Example:
Sep 1 | Present | 09:04
Sep 2 | WFH | 09:12
Sep 3 | Present — Corrected
Sep 4 | Medical Leave
Sep 5 | Absent — Documentation Missing

6. WFH MANAGEMENT

6.1 Employee WFH Configuration
Add an employee configuration/list page in the left sidebar.
Every employee should have a WFH toggle:
- Office
- WFH Enabled

Admin can change the employee’s WFH configuration.

6.2 WFH Employees on Board
Add a separate “Work From Home Employees” section below the normal employee/attendance section on the Board.
Show:
- Employee
- WFH status
- Check-in status
- Check-in time
- Location status where applicable

6.3 Permanent WFH Attendance & GPS
For employees configured as WFH:
- Mobile app recognizes WFH status.
- GPS/location permission becomes mandatory for WFH attendance.
- Employee enables location.
- Employee checks in.
- Attendance is recorded as WFH.
- Relevant location and timestamp are available to authorized admins.

Do not collect unnecessary continuous location data if attendance verification only requires location at check-in.

6.4 Temporary WFH Request
Non-permanent-WFH employees can request WFH for a specific date.
Request includes date and reason.
Admin can approve/reject.
After approval, employee receives notification that GPS/location permission is mandatory.
Approved employee can perform WFH check-in.

6.5 Employee Location Detail
Clicking a WFH employee should open an employee detail view containing:
- Employee details
- WFH status
- Current/most recent authorized location
- Location timestamp
- WFH check-in time
- Attendance status

7. LEAVE REASON VALIDATION

The mobile leave request flow should use predefined, admin-configurable categories.

Initial suggested categories:
1. Personal
2. Family emergency
3. Medical/health-related
4. Family/household responsibility
5. Other legitimate personal reason

Flow:
Select category -> Enter additional explanation -> Submit

The selected category and employee explanation must be stored separately.

Clearly invalid/unacceptable reasons should be rejected by validation rather than silently accepted. The exact validation mechanism should fit the existing application architecture.

8. SHIFT MANAGEMENT

8.1 Shift Management Page
Add Shift Management to the left sidebar.
Admin can:
- Configure organization/default shift.
- Configure group shifts.
- Configure employee-specific shifts.

Example:
09:00 AM - 06:30 PM

8.2 Organization-Wide Shift
Provide a default organization shift.
New employees can inherit it according to existing employee assignment rules.
Do not unexpectedly overwrite existing employee-specific assignments.

8.3 Employee-Specific Shift
Show an employee list with:
- Employee
- Current shift
- Edit action

An employee-specific shift overrides broader defaults.

8.4 Group-Based Shift Management
Allow admins to:
- Create/select groups.
- Select employees using checkboxes.
- Add/remove employees from groups.
- Assign a shift to the group.
- Modify a group’s shift.

Individual employee assignment must remain possible.

8.5 Shift Priority
Recommended deterministic hierarchy:
Employee-specific shift
-> Group shift
-> Organization/default shift

9. NOTIFICATIONS

Leave:
- Submitted
- Approved
- Rejected
- Partially approved
- Medical document required
- Deadline approaching
- Deadline exceeded

WFH:
- Submitted
- Approved
- Rejected
- GPS required
- GPS permission missing

Correction:
- Submitted
- Approved
- Rejected
- Correction limit reached

10. AUDIT TRAIL

Important request/status changes must record:
- Employee
- Request type
- Previous status
- New status
- Actor
- Date/time
- Source
- Relevant metadata

Example:
Leave: Pending -> Approved
Changed by: Admin
Timestamp: 06 Sep 2026, 11:32 AM

11. SEARCH & FILTERING

History and employee lists should support:
- Employee search
- Month/date range
- Attendance status
- Leave type
- WFH status
- Correction status
- Shift/group

Filters should be combinable.

12. ACCESS CONTROL

Only authorized admins may:
- Change WFH configuration.
- View authorized employee location data.
- Change shifts and correction limits.
- Approve/reject requests.
- View sensitive historical data.

Employees should only access their own requests/attendance and perform actions permitted by their configuration.

Backend authorization must enforce permissions; frontend checks alone are insufficient.

13. GPS PRIVACY & SECURITY

GPS should only be collected when required for WFH attendance.
- Clearly inform the employee when GPS is required.
- Request mobile location permission.
- Associate location with the relevant WFH attendance/request.
- Restrict visibility to authorized administrators.
- Record capture timestamp.
- Avoid unnecessary continuous tracking.

14. EDGE CASES

Leave:
- Duplicate leave request.
- Already processed request.
- Late medical document.
- Partial approval converted to final decision.
- Overlapping leave.

Corrections:
- Correction limit reached.
- Duplicate correction for same date.
- Rejected correction.
- Expired request.

WFH:
- GPS permission denied.
- GPS unavailable.
- GPS disabled after approval.
- Temporary WFH expiration.
- Permanent and temporary WFH conflict.

Shifts:
- Employee in multiple groups.
- Group and employee-specific shift conflict.
- Organization shift changes.
- Existing custom shifts.

15. DASHBOARD INTEGRATION

Do not disrupt the existing dashboard.
Where useful, add:
- Pending Leaves
- Pending Corrections
- WFH Employees
- WFH Present
- Absent Employees
- Attendance Exceptions
- Recent Corrections
- Recent Leave Decisions

Cards should navigate to detailed pages.

16. NAVIGATION

Recommended sidebar structure:

Dashboard
- Overview
- Board

Attendance
- Attendance
- Corrections
- Exceptions
- Attendance History

Leave
- Leave Requests
- Leave Status
- Leave History

Workforce
- Employees
- WFH Employees
- Shift Management

History
- History Overview
- Attendance
- Leave
- Corrections
- Exceptions
- WFH

Analytics
- Attendance Distribution
- Historical Pie Chart

Use existing naming/design conventions where appropriate.

17. DATA INTEGRITY & BACKWARD COMPATIBILITY

All new workflows must use the existing employee, attendance, leave, correction, notification, and authentication architecture where practical.

Before adding database fields or migrations:
- Inspect existing schema.
- Reuse existing fields when safe.
- Avoid unnecessary migrations.
- Preserve existing data.
- Provide safe defaults for legacy records.
- Ensure old records remain viewable.

Status changes made through email, dashboard, mobile app, or history views must remain synchronized.

18. UX REQUIREMENTS

- Preserve the existing visual language.
- Reuse existing components.
- Avoid unnecessary redesign.
- Provide loading, empty, error, success, and disabled states.
- Use expandable panels for secondary details.
- Confirm impactful admin actions.
- Keep navigation intuitive.
- Avoid placeholder/fake production data.

19. SUCCESS CRITERIA

The enhancement is successful when:
- Leave decisions can be handled efficiently and are fully auditable.
- Medical leave/document deadlines are enforceable.
- Correction requests are controlled and traceable.
- Historical attendance is accessible at employee and category levels.
- WFH attendance is clearly differentiated and GPS-verified when required.
- Shift assignment is manageable at organization, group, and employee levels.
- Existing functionality remains stable.
- All major workflows are persisted correctly and synchronized across clients.

20. IMPLEMENTATION PHASES

Phase 1 — Leave Workflow
1. Email Leave Approval/Rejection
2. Dedicated Leave Status Page
3. Pending Leave Status
4. Medical Leave & Partial Approval
5. Medical Documentation Workflow

Phase 2 — Attendance Corrections
6. Predefined Correction Reasons
7. Correction Limits
8. Correction Management Page
9. Employee Correction Summary
10. Correction-Based Attendance Identification

Phase 3 — History & Analytics
11. Attendance History
12. Flexible History Date Range
13. Attendance Status Visual Indicators
14. Centralized History Overview
15. Interactive History Pie Chart

Phase 4 — WFH & GPS
16. Employee WFH Configuration
17. WFH Employees Board Section
18. WFH Attendance & GPS Verification
19. Temporary WFH Requests
20. Employee Location Detail

Phase 5 — Leave Validation & Shifts
21. Leave Reason Validation
22. Shift Management
23. Organization-Wide Shift
24. Employee-Specific Shift
25. Group-Based Shift Management
