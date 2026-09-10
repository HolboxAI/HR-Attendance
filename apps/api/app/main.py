import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    admin, admin_corrections,
    admin_employees, admin_jobs, admin_leave, admin_location, admin_history, admin_shifts, admin_signups, auth, corrections,
    enrolment, health, ingest, leave, mobile, notifications, slack, wfh,
)
from app.core.config import settings

log = logging.getLogger("boxcode.scheduler")


async def _scheduler_loop() -> None:
    """Tick the scheduled jobs for as long as the API is up.

    In-process on purpose: attendance only happens while the API is running,
    and a laptop prototype has no cron worth trusting. The DB work is sync
    SQLAlchemy, so each tick runs in a worker thread rather than blocking the
    event loop that is also serving punches.

    A tick that fails is logged and the loop keeps going - the alternative is
    a scheduler that silently died at 9am and nobody's nudge firing again
    until someone restarts the server and wonders why.
    """
    from app.db.session import SessionLocal
    from app.services.scheduler import tick

    def one_tick() -> dict:
        db = SessionLocal()
        try:
            return tick(db)
        finally:
            db.close()

    while True:
        try:
            summary = await asyncio.to_thread(one_tick)
            if summary["jobs"]:
                log.info("scheduler tick: %s", summary["jobs"])
            for name, err in summary["errors"].items():
                log.error("scheduler job %s failed: %s", name, err)
        except Exception:                 # noqa: BLE001 - the loop must survive
            log.exception("scheduler tick failed")
        await asyncio.sleep(settings.scheduler_interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        from app.db.base import Base
        from app.db.session import engine
        import app.models  # noqa: F401
        Base.metadata.create_all(bind=engine, checkfirst=True)
    except Exception:
        pass

    task = (
        asyncio.create_task(_scheduler_loop())
        if settings.scheduler_enabled
        else None
    )
    yield
    if task is not None:
        task.cancel()


app = FastAPI(
    title="Boxcode HRMS API",
    version="0.1.0",
    description="Attendance-first HR platform. All capture methods converge on one punch event.",
    lifespan=lifespan,
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
app.include_router(admin_jobs.router, prefix=settings.api_prefix)
app.include_router(admin_history.router, prefix=settings.api_prefix)
app.include_router(notifications.router, prefix=settings.api_prefix)
app.include_router(slack.router, prefix=settings.api_prefix)
app.include_router(wfh.router, prefix=settings.api_prefix)
app.include_router(admin_shifts.router, prefix=settings.api_prefix)
app.include_router(admin_signups.router, prefix=settings.api_prefix)

