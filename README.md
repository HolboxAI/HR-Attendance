# Boxcode HRMS

An enterprise-grade, attendance-first Human Resource Management System (HRMS) built for modern teams. Features AI facial recognition check-in, geofencing, multi-tier shift scheduling, 1-click email and Slack leave approvals, and employee self-service.

---

## 🌟 Key Features

### 1. Attendance & Verification
* **Facial Recognition**: Live face capture matched against enrolled employee reference embeddings via **AWS Rekognition**.
* **Camera Fallback**: Seamless fallback for web check-in on devices or unencrypted HTTP connections without breaking biometric pipelines.
* **Geofence & Location Enforcement**: GPS radius validation ensures check-ins occur strictly on-premises.
* **Append-Only Punch Events**: Normalized punch events are immutable, idempotent, and resilient to device retries or network outages.

### 2. Multi-Tier Shift Management (PRD §8.5)
* **Deterministic 4-Tier Hierarchy**:
  1. **Direct Employee Override**: Specific date-bounded assignments.
  2. **Shift Squads / Groups**: Department-level schedules (e.g. Intern Squad 3:00 PM – 8:00 PM).
  3. **Organization Default Shift**: Company-wide standard timing.
  4. **Fallback Policy**: Built-in 09:00 – 18:00 standard day shift.
* **Shift Deletion Protection**: Built-in safeguards prevent accidental deletion of active organization default shifts.
* **Live Roster Matrix**: Real-time view of daily assigned shifts, timing windows, and group memberships.

### 3. Shift-Aware Notifications & Alerts
* **Precision Scheduler**: Late arrival and absence alerts are calculated relative to each employee's effective shift window (e.g., afternoon interns starting at 3:00 PM will never trigger false 9:00 AM alerts).
* **Slack Bot Alerts**: Automated notifications dispatched to designated Slack channels for missing check-ins or late arrivals.
* **Missing Punch-Out Nudges**: Automated reminders fired for incomplete shifts after the shift cutover threshold.

### 4. Leave Management & 1-Click Approvals
* **5 Official Leave Categories**: Personal, Family emergency, Medical/health-related, Family/household responsibility, and Other legitimate personal reasons.
* **1-Click Email Decision**: Actionable emails with HMAC-signed tokens allowing admins to approve or reject leave with a single tap in Gmail.
* **Slack Interactive Cards**: Real-time leave request cards with interactive Approve and Reject action buttons.
* **Balance & Overlap Protection**: Strict prevention against overlapping dates, double approvals, and self-approval loopholes. Half-day (0.5) and unpaid leave rules natively supported.

### 5. Web & Mobile Client Apps
* **Admin Dashboard (Next.js 14)**:
  * Live employee attendance board with filterable views.
  * Shift assignment hub (`/people/shifts`).
  * Leave status tracking & audit tables (`/leave/status`, `/leave/audit`).
  * Attendance history cards & correction reviews (`/history`, `/corrections`).
  * Comprehensive Settings & Profile Hub (`/settings`) with password strength checks and dark/light theme options.
* **Employee Mobile App (React Native / Expo)**:
  * 1-tap facial check-in with GPS location tagging.
  * Leave and correction request submissions.
  * Monthly attendance and hours breakdown.

---

## 🏗 Repository Structure

```
boxcode-hrms/
├── apps/
│   └── api/                  # FastAPI Backend
│       ├── alembic/          # Database migrations
│       ├── app/
│       │   ├── api/routes/   # REST endpoints (auth, shifts, leave, slack, attendance)
│       │   ├── core/         # Config, security, clock, and AWS helpers
│       │   ├── models/       # SQLAlchemy models (Postgres / SQLite)
│       │   └── services/     # Core engine (resolver, scheduler, face, geofence, slack)
│       └── tests/            # Automated test suite (18 standalone test suites)
│
├── myco-frontend/
│   ├── web/                  # Next.js 14 Admin Dashboard (Tailwind, Lucide icons)
│   └── mobile/               # React Native / Expo Mobile Application
│
└── docs/                     # Architecture and deployment specifications
```

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
* **Python 3.10+** (Python 3.12+ recommended)
* **Node.js 20+**
* **Git**

### 2. Run the Backend API

```bash
cd apps/api

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start API server
uvicorn app.main:app --reload --port 8000
```
Interactive Swagger API documentation will be available at `http://localhost:8000/docs`.

### 3. Run the Web Dashboard

```bash
cd myco-frontend/web

# Install dependencies
npm install

# Start Next.js development server
npm run dev
```
Open `http://localhost:3000` in your browser.

### 4. Run the Mobile App

```bash
cd myco-frontend/mobile

# Install dependencies
npm install

# Start Expo development server
npx expo start
```
Scan the displayed QR code with the Expo Go app on iOS or Android.

---

## 🧪 Testing & Verification

The codebase comes with complete automated test coverage across unit tests, service schedulers, and edge cases.

```bash
cd apps/api

# Run all 18 core subsystem test suites
./.venv/bin/python -m pytest tests/  # or run individual tests via python3 tests/<file>.py

# Run in-depth edge case verification (Shift hierarchy, 3 PM intern checks, 1-click approvals)
./.venv/bin/python test_all_edge_cases_in_depth.py

# Run live integration verification against deployed EC2 instance
./.venv/bin/python test_live_edge_cases_http.py
```

---

## ⚙️ Environment Configuration (`apps/api/.env`)

| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | Database connection string (`postgresql://...` or `sqlite:///...`) |
| `JWT_SECRET` | 256-bit cryptographically secure session signing key |
| `AWS_ACCESS_KEY_ID` | AWS IAM credentials for Rekognition & S3 storage |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key |
| `AWS_REGION` | AWS target region (`ap-south-1`) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret for request verification |
| `SLACK_CHANNEL_ID` | Target admin channel ID for attendance alerts and cards |
| `SMTP_HOST` | Outbound mail server (e.g., `smtp.gmail.com`) |
| `SMTP_PORT` | Mail server port (`587`) |
| `SMTP_USER` | Admin sender email address |
| `SMTP_PASS` | SMTP application password |

---

## 🔒 Security & Compliance
* Passwords stored with **Argon2 / bcrypt + SHA-256** digests.
* HMAC-signed JWT action tokens for all external decision links with automatic expiration and replay protection.
* Role-Based Access Control (Super Admin, HR Admin, Employee).
