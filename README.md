# ⚡ AttendX — Enterprise AI Biometric & Geofenced Attendance Platform

[![Deployment Status](https://img.shields.io/badge/Deployment-AWS%20EC2-orange?logo=amazon-aws)](https://attendance.holbox.ai)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Next.js 14](https://img.shields.io/badge/Frontend-Next.js%2014-black?logo=next.js)](https://nextjs.org)
[![AWS Rekognition](https://img.shields.io/badge/Biometrics-AWS%20Rekognition-232F3E?logo=amazon-aws)](https://aws.amazon.com/rekognition/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An enterprise-grade, attendance-first platform built for high-velocity teams. Features **instant AI facial recognition (<1s check-in)**, **geofencing & office radius enforcement**, **multi-tier shift scheduling**, **Slack interactive slash commands & 1-click approvals**, and **granular attendance analytics with automated PDF/CSV exports**.

🌐 **Live Deployed App (AWS EC2)**: [https://attendance.holbox.ai](https://attendance.holbox.ai)

---

## 📸 Platform Showcase

<div align="center">
  <h3>✨ Modern Dark-Mode Executive Dashboard</h3>
  <img src="docs/screenshots/dashboard.png" alt="AttendX Dashboard" width="100%" />
</div>

<br/>

<div align="center">
  <h3>🎯 1-Tap Biometric Check-In & State Tracker</h3>
  <img src="docs/screenshots/checkin.png" alt="AttendX 1-Tap Biometric Check-In" width="85%" />
</div>

---

## 🌟 Core System Architecture

### 1. ⚡ Instant Biometric & Geofenced Punch
* **AWS Rekognition AI Matching**: 1-tap live selfie capture matched in under 1 second against indexed reference vectors with high confidence scoring.
* **Geofence Radius Validation**: Haversine GPS distance calculation guarantees check-ins occur strictly within verified office premises.
* **4-State Real-Time Lifecycle**: State machine transitions across `Check-In` ➔ `Start Break` ➔ `End Break & Resume` ➔ `Check-Out`.
* **Tamper-Proof & Idempotent**: SHA-256 event hashing prevents duplicate punch replay attacks or multi-device desynchronization.

### 2. 💬 Slack Interactive Attendance Commands
* **Instant Slash Commands**: Full suite of slash commands (`/checkin`, `/checkout`, `/break`, `/resume`, `/leave`, `/wfh`, `/late`).
* **Zero Channel Chatter**: Interactive commands open private modal dialogs and single-use 1-tap camera links with zero public channel clutter.
* **1-Click Admin Decision Cards**: Admins receive private interactive approval/rejection cards directly in Slack with real-time employee notification broadcasts.

### 3. ⏱ Multi-Tier Shift Resolution Engine
* **Deterministic 4-Tier Hierarchy**:
  1. **Direct Employee Assignment**: Specific date-bounded custom shifts.
  2. **Shift Squads / Groups**: Department schedules (*Engineers 1:00 PM – 9:00 PM*, *Interns 4:00 PM – 8:00 PM*, *Operations 1:00 PM – 9:00 PM*, *IIM Students 6:00 PM – 10:00 PM*).
  3. **Organization Default Shift**: Company standard timings.
  4. **Fallback Shift Policy**: Default 09:00 – 18:00 policy.
* **Precision Late & Cutover Calculation**: Late minutes and absence alerts are calculated relative to each person's exact assigned shift window.

### 4. 🌴 Leave Policies & Balance Management
* **Strict Balance & Overlap Safeguards**: Automatic validation against overlapping dates, double booking, and leave quotas.
* **Official Categories**: Comprehensive leave tracking with support for Paid (CL, SL, PL), Unpaid (LOP), Half-Day, and Medical Certificates.
* **Multi-Format Exports**: 1-click automated PDF and Excel/CSV attendance register generator with worked hours, break duration, and late time breakdown.

---

## 🏗 Repository Structure

```
.
├── apps/
│   └── api/                  # FastAPI Backend Server
│       ├── alembic/          # Database migrations
│       ├── app/
│       │   ├── api/routes/   # REST endpoints (auth, attendance, shifts, leave, slack, admin)
│       │   ├── core/         # Config, security, clock (IST org time), and AWS helpers
│       │   ├── models/       # SQLAlchemy models (PostgreSQL / SQLite)
│       │   └── services/     # Biometric engine, attendance resolver, scheduler, PDF exporter
│       └── tests/            # Automated test suites
│
├── myco-frontend/
│   ├── web/                  # Next.js 14 Web Dashboard (Tailwind CSS, Lucide icons)
│   └── mobile/               # React Native / Expo Mobile Application
│
├── docs/                     # Documentation & UI assets
│   └── screenshots/          # Platform preview captures (dashboard.png, checkin.png)
│
└── deploy_to_ec2.sh          # Safe deployment automation script for AWS EC2
```

---

## 🚀 Quick Start (Local Setup)

### 1. Backend API (FastAPI)

```bash
cd apps/api

# Setup virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run migrations & start server
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```
Interactive Swagger API documentation will be available at `http://localhost:8000/docs`.

### 2. Admin Web Dashboard (Next.js 14)

```bash
cd myco-frontend/web

# Install dependencies
npm install

# Start Next.js development server
npm run dev
```
Open `http://localhost:3000` in your browser.

---

## ☁️ Production Deployment (AWS EC2)

The application is deployed on **AWS EC2** using **Systemd** for the FastAPI backend and **PM2** with **Nginx** reverse proxy for the Next.js web application.

To deploy safe incremental updates without database overwrites:

```bash
chmod +x deploy_to_ec2.sh
./deploy_to_ec2.sh
```

---

## ⚙️ Key Environment Configuration

| Variable | Description |
| :--- | :--- |
| `DATABASE_URL` | Database connection string (`sqlite:///data/boxcode.db` or PostgreSQL) |
| `JWT_SECRET` | 256-bit cryptographically secure session signing key |
| `AWS_ACCESS_KEY_ID` | AWS IAM credentials for Rekognition & S3 storage |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key |
| `AWS_REGION` | AWS target region (`us-east-1` / `ap-south-1`) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret for request verification |
| `SLACK_CHANNEL_ID` | Target attendance channel ID for notifications and alerts |

---

## 🔒 Security & Compliance
* Passwords stored with **Argon2 / bcrypt + SHA-256** cryptographic digests.
* HMAC-signed JWT action tokens for all external decision links with automatic expiration and replay protection.
* Strict Role-Based Access Control (Super Admin, HR Admin, Employee).
