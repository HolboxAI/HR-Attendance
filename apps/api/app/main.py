from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    admin, admin_corrections,
    admin_employees, admin_leave, admin_location, auth, corrections, enrolment,
    health, ingest, leave, mobile, notifications,
)
from app.core.config import settings

app = FastAPI(
    title="Boxcode HRMS API",
    version="0.1.0",
    description="Attendance-first HR platform. All capture methods converge on one punch event.",
)

app.add_middleware(
    CORSMiddleware,
    # :3000 is the dashboard. :8081 is Expo's WEB build of the mobile app -
    # a browser preview used when a phone's Expo Go lags the project's SDK.
    # The real handset never appears here: native fetch has no origin and no
    # CORS. So this widens nothing for production phones; it lets the web
    # preview reach the same API the phone would.
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:8081", "http://127.0.0.1:8081",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(ingest.router, prefix=settings.api_prefix)
app.include_router(mobile.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(enrolment.router, prefix=settings.api_prefix)
app.include_router(leave.router, prefix=settings.api_prefix)
app.include_router(admin_leave.router, prefix=settings.api_prefix)
app.include_router(corrections.router, prefix=settings.api_prefix)
app.include_router(admin_corrections.router, prefix=settings.api_prefix)
app.include_router(admin_employees.router, prefix=settings.api_prefix)
app.include_router(admin_location.router, prefix=settings.api_prefix)
app.include_router(notifications.router, prefix=settings.api_prefix)

