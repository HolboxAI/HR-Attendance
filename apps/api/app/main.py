from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    admin, admin_leave, auth, enrolment, health, ingest, leave, mobile,
)
from app.core.config import settings

app = FastAPI(
    title="Boxcode HRMS API",
    version="0.1.0",
    description="Attendance-first HR platform. All capture methods converge on one punch event.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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

