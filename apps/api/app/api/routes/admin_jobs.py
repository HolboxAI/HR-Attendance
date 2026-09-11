"""What the scheduler did, and a way to make it do it now.

Two endpoints, both thin. GET /runs is the audit view: "did the accrual timer
fire this month", "why did the app nudge Shivam on Tuesday" - answered from
the rows, not from log spelunking. POST /tick exists for the demo and the
sceptic: the background loop fires every minute anyway, but "click this and
watch the notification appear" beats "wait up to sixty seconds" in front of
an audience, and it is how the live-verification scripts exercise the jobs
over HTTP.

hr_admin, not super_admin: these jobs move leave balance and write
notifications, which is HR's territory - the same rank that can already run
accrual by hand from the leave page.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.employee import User
from app.models.enums import UserRole
from app.models.scheduler import ScheduledJobRun
from app.services.scheduler import tick

router = APIRouter(prefix="/admin/jobs", tags=["jobs"])
hr_only = Depends(require_role(UserRole.HR_ADMIN))


class JobRunRow(BaseModel):
    job_name: str
    dedupe_key: str
    detail: dict
    ran_at: datetime


@router.get("/runs", response_model=list[JobRunRow])
def recent_runs(
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db), user: User = hr_only,
):
    rows = db.scalars(
        select(ScheduledJobRun)
        .where(ScheduledJobRun.org_id == user.org_id)
        .order_by(ScheduledJobRun.created_at.desc())
        .limit(limit)
    ).all()
    return [
        JobRunRow(job_name=r.job_name, dedupe_key=r.dedupe_key,
                  detail=r.detail, ran_at=r.created_at)
        for r in rows
    ]


@router.post("/tick")
def run_tick(db: Session = Depends(get_db), user: User = hr_only):
    """Run every due job right now. Idempotent - clicking twice is a no-op,
    because each job's dedupe row survives the first click."""
    return tick(db)


@router.post("/shift-summary")
def trigger_shift_summary(
    template_id: uuid.UUID | None = Query(default=None),
    shift_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = hr_only,
):
    """Trigger a shift attendance summary email on demand for testing or manual dispatch."""
    import uuid as _uuid
    from datetime import date as _date
    from app.core.clock import org_now
    from app.models.org import Organization
    from app.services.scheduler import run_shift_end_summaries

    org = db.get(Organization, user.org_id)
    if org is None:
        return {"ok": False, "error": "Organization not found"}

    now = org_now()
    d = _date.fromisoformat(shift_date) if shift_date else None
    results = run_shift_end_summaries(
        db=db,
        org=org,
        now=now,
        force_template_id=template_id,
        for_date=d,
    )
    db.commit()
    return {"ok": True, "summaries_sent": results}
