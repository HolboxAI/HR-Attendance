# Boxcode HRMS - AWS Architecture & Deployment Guide

This document summarizes the recommended cloud architecture, storage, and EC2 sizing for hosting the Boxcode HRMS platform (Next.js web dashboard + FastAPI backend + database + storage).

---

## 1. Executive Summary & Recommended Cloud Budget

| Component | AWS Service & Type | Specifications | Estimated Cost / Month (ap-south-1 Mumbai) |
| :--- | :--- | :--- | :--- |
| **Full Stack Compute**<br>(Next.js Web + FastAPI + Nginx) | **EC2 `t4g.medium`** (Ubuntu 24.04 ARM64) | 2 vCPUs, 4 GB RAM, 30 GB gp3 SSD | ~$27.00 / month<br>*(~$15/mo on 1-yr Savings Plan)* |
| **Relational Database** | **AWS RDS PostgreSQL** (`db.t4g.micro`) | 2 vCPUs, 1 GB RAM, 20 GB Storage (Automated daily snapshots) | ~$15.00 / month |
| **Photos & Document Storage** | **AWS S3 Standard** | Up to 100 GB storage (encrypted, private ACL) | ~$3.00 / month |
| **Face Recognition AI** | **AWS Rekognition** | `CompareFaces` API (~5,000 punch selfie matches) | ~$5.00 / month |
| **Total Estimated Cloud Cost** | | | **~$50 / month** |

---

## 2. Why `t4g.medium` is the Ideal EC2 Instance

Because facial recognition matching is offloaded to **AWS Rekognition**, the EC2 server does not require expensive GPUs or high-compute instances.

### Resource Allocation on `t4g.medium` (2 vCPU, 4 GB RAM):
- **Next.js Web Server (Port 3000)**: ~600 MB RAM, 1 vCPU
- **FastAPI / Uvicorn (Port 8000)**: ~500 MB RAM, 1 vCPU
- **Background Scheduler & Task Queue**: ~150 MB RAM
- **Nginx Reverse Proxy & SSL (Certbot)**: ~50 MB RAM
- **Operating System & Buffer Headroom**: ~1.5 GB RAM free buffer to prevent Out-Of-Memory (OOM) crashes

### Alternative Instance Options:
- **`t4g.small` (2 vCPU, 2 GB RAM - ~$12.20/mo)**: Best for development, QA, or staging environments.
- **`t3.medium` (2 vCPU, 4 GB RAM - ~$30.30/mo)**: Intel x86_64 alternative if your team requires standard x86 Docker images.

---

## 3. Storage Migration Plan: Local to AWS

| Data Type | Current Local Storage | Target AWS Service | Why |
| :--- | :--- | :--- | :--- |
| **Application Database** | SQLite file at `data/boxcode.db` | **AWS RDS PostgreSQL** | SQLite locks the entire database on concurrent writes (e.g. morning punch rushes). RDS provides multi-AZ reliability, automated backups, and row-level locking. |
| **Selfies & Medical Documents** | Local folder `data/uploads/` | **AWS S3 Bucket** (e.g., `boxcode-uploads-prod`) | S3 provides 99.999999999% durability and eliminates disk space limits on EC2. The backend `storage.py` is already designed for S3 key prefixes. |
| **Face Recognition** | AWS Rekognition | AWS Rekognition (`ap-south-1`) | Already implemented and tested via `boto3`. |

---

## 4. Production Deployment Topology

```
                  ┌──────────────────────────────────────────────┐
                  │                 AWS Cloud                    │
                  │                                              │
Client Browsers ─>│   EC2 (t4g.medium)                           │
Mobile App Handsets│  ├── Nginx (Reverse Proxy + SSL)            │
                  │   ├── Next.js Frontend (Port 3000)           │
                  │   └── FastAPI Backend (Port 8000)            │
                  │          │                  │                │
                  └──────────┼──────────────────┼────────────────┘
                             ▼                  ▼
                    ┌─────────────────┐  ┌──────────────┐
                    │  AWS RDS        │  │  AWS S3      │
                    │  PostgreSQL     │  │  Bucket      │
                    │  (db.t4g.micro) │  │  (Uploads)   │
                    └─────────────────┘  └──────────────┘
```
