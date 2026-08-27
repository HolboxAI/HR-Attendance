"""Office location and presence policy.

super_admin only, and this is the first endpoint in the system that is. The
PRD assigns "locations, presence policy, roles, security settings" to the
super admin specifically, and until now nothing enforced that - every gated
route topped out at hr_admin, so Himesh and Krish had identical access.

Why these fields are worth guarding more tightly than the rest: widening the
radius or switching to gps_only silently weakens the check behind every punch
the company makes, and unlike a leave quota there is no obvious symptom. A
wrong quota gets noticed by the person short-changed. A geofence quietly set
to 50km looks exactly like one that works.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.employee import User
from app.models.enums import UserRole
from app.models.org import Location
from app.services.geofence import PresencePolicy
from app.services.leave import audit

router = APIRouter(prefix="/admin/location", tags=["location"])

# Read is manager-and-above: a manager fielding "why was I refused?" needs to
# see the radius and the policy to answer it.
reader = Depends(require_role(UserRole.MANAGER))
super_only = Depends(require_role(UserRole.SUPER_ADMIN))

# Below this a phone sitting still at a desk starts failing on GPS drift
# alone. See the long comment in app/services/geofence.py: a false reject
# marks somebody absent for a day they worked.
MIN_SAFE_RADIUS_M = 50


def normalise_bssid(value: str) -> str:
    """Lower-case, colon-separated. Matches _normalize_bssid in geofence.py.

    Applied on the way IN so the stored value is already canonical, rather
    than relying on every reader to normalise identically.
    """
    return value.strip().lower().replace("-", ":")


class LocationOut(BaseModel):
    name: str
    lat: float | None
    lng: float | None
    radius_m: int
    presence_policy: str
    allowed_bssids: list[str]
    # Named as a question rather than a flag, because the answer is the whole
    # point of the screen this feeds.
    wifi_can_be_required: bool
    note: str | None = None


class UpdateRequest(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int | None = Field(default=None, ge=10, le=50_000)
    presence_policy: PresencePolicy | None = None
    allowed_bssids: list[str] | None = None

    @field_validator("allowed_bssids")
    @classmethod
    def check_bssids(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        out = []
        for raw in v:
            b = normalise_bssid(raw)
            parts = b.split(":")
            if len(parts) != 6 or not all(
                len(p) == 2 and all(c in "0123456789abcdef" for c in p) for p in parts
            ):
                raise ValueError(
                    f"'{raw}' is not a MAC address. Expected six hex pairs, "
                    f"like a4:2b:8c:11:03:f7"
                )
            if b not in out:
                out.append(b)
        return out


def to_out(loc: Location) -> LocationOut:
    bssids = list(loc.allowed_bssids or [])
    note = None
    if loc.presence_policy == PresencePolicy.WIFI_REQUIRED.value and not bssids:
        # Should be unreachable - the update path refuses it - but a database
        # edited by hand could still get here, and the honest thing is to say
        # so rather than let the board look fine while nobody can punch.
        note = "wifi_required with no registered access points: every punch will be refused"
    elif not bssids:
        note = "No access points registered, so presence rests on GPS alone"
    return LocationOut(
        name=loc.name, lat=float(loc.lat) if loc.lat is not None else None,
        lng=float(loc.lng) if loc.lng is not None else None,
        radius_m=loc.geofence_radius_m, presence_policy=loc.presence_policy,
        allowed_bssids=bssids, wifi_can_be_required=bool(bssids), note=note,
    )


def _the_location(db: Session) -> Location:
    loc = db.scalar(select(Location))
    if loc is None:
        raise HTTPException(404, "No office configured. Run scripts/seed.py.")
    return loc


@router.get("", response_model=LocationOut)
def read_location(db: Session = Depends(get_db), _: User = reader):
    return to_out(_the_location(db))


@router.put("", response_model=LocationOut)
def update_location(
    body: UpdateRequest, db: Session = Depends(get_db), actor: User = super_only,
):
    loc = _the_location(db)
    changes: dict = {}

    wanted_policy = body.presence_policy.value if body.presence_policy else loc.presence_policy
    wanted_bssids = (
        body.allowed_bssids if body.allowed_bssids is not None
        else list(loc.allowed_bssids or [])
    )

    # The one combination that locks the whole company out. Refusing it here
    # is worth more than any warning banner: wifi_required with nothing to
    # match against refuses every punch, and it would look like the app
    # breaking rather than a setting being wrong.
    if wanted_policy == PresencePolicy.WIFI_REQUIRED.value and not wanted_bssids:
        raise HTTPException(
            409,
            "wifi_required needs at least one registered access point, or "
            "every punch would be refused. Add the office BSSIDs first.",
        )

    if body.lat is not None and float(loc.lat or 0) != body.lat:
        changes["lat"] = {"old": str(loc.lat), "new": str(body.lat)}
        loc.lat = body.lat
    if body.lng is not None and float(loc.lng or 0) != body.lng:
        changes["lng"] = {"old": str(loc.lng), "new": str(body.lng)}
        loc.lng = body.lng

    if body.radius_m is not None and loc.geofence_radius_m != body.radius_m:
        changes["radius_m"] = {"old": loc.geofence_radius_m, "new": body.radius_m}
        loc.geofence_radius_m = body.radius_m

    if wanted_policy != loc.presence_policy:
        changes["presence_policy"] = {"old": loc.presence_policy, "new": wanted_policy}
        loc.presence_policy = wanted_policy

    if body.allowed_bssids is not None and list(loc.allowed_bssids or []) != wanted_bssids:
        changes["allowed_bssids"] = {
            "old": list(loc.allowed_bssids or []), "new": wanted_bssids,
        }
        loc.allowed_bssids = wanted_bssids

    if changes:
        audit(db, org_id=loc.org_id, actor=actor, entity="location",
              entity_id=loc.id, action="updated", changes=changes)
        db.commit()

    out = to_out(loc)
    if body.radius_m is not None and body.radius_m < MIN_SAFE_RADIUS_M:
        out.note = (
            f"{body.radius_m}m is tighter than GPS can reliably resolve indoors. "
            f"Expect people to be refused at their own desks."
        )
    return out
