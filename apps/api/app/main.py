from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health, ingest
from app.core.config import settings

app = FastAPI(
    title="Boxcode HRMS API",
    version="0.1.0",
    description="Attendance-first HR platform. All capture methods converge on one punch event.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=settings.api_prefix)
app.include_router(ingest.router, prefix=settings.api_prefix)
app.include_router(ingest.adms)          # vendor path is fixed, no prefix
