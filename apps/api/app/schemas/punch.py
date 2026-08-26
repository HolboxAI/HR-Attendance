from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import PunchDirection, PunchSource


class PunchIn(BaseModel):
    """The ONE shape every capture method must produce.

    A gate reader, the mobile app, a reception kiosk and an HR manual entry all
    arrive here identically. Adapters translate; the core stays vendor-neutral.
    """

    device_serial: str | None = None
    device_user_id: str | None = Field(
        default=None, description="The reader's own user id, mapped via device_enrollments"
    )
    employee_code: str | None = Field(
        default=None, description="Used when the source is mobile/kiosk/manual"
    )
    event_ts: datetime = Field(description="Timezone-aware. Device clock, not ours.")
    direction: PunchDirection = PunchDirection.UNKNOWN
    source: PunchSource = PunchSource.GATE_DEVICE
    lat: float | None = None
    lng: float | None = None
    photo_key: str | None = None
    raw: dict = Field(default_factory=dict)


class PunchBatchIn(BaseModel):
    """Devices coming back from an outage dump their whole buffer at once."""

    punches: list[PunchIn]


class PunchAccepted(BaseModel):
    accepted: int
    duplicates: int
    unmatched: int
    affected_dates: list[str]
