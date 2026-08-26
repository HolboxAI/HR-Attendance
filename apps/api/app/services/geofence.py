"""Is this punch actually IN the office?

Requirement: punching must only work inside the office - not from the car park,
not from the gate, not from home.

GPS alone cannot deliver that. A consumer phone is accurate to roughly 10-30m
outdoors and considerably worse indoors, so any radius tight enough to exclude
the car park will also start rejecting people sitting at their desks. Tightening
the radius past a point trades false-accepts for false-rejects, and a false
reject means an employee is marked absent for a day they worked - which is the
worse failure.

So we use two independent signals:

  1. GPS radius        - coarse, spoofable, always available
  2. Office WiFi BSSID - the MAC address of the office access point

The BSSID is the strong one. To see it you must be within WiFi range and
actually associated to that access point, which for practical purposes means
you are in the building. It cannot be faked from home without physically
cloning the AP.

Policy is per-location so the office can start lenient and tighten once we see
real data.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

EARTH_RADIUS_M = 6_371_000.0

MAX_ACCEPTABLE_ACCURACY_M = 100.0
MAX_FIX_AGE_SECONDS = 120


class PresencePolicy(str, Enum):
    GPS_ONLY = "gps_only"          # radius alone. Weakest.
    WIFI_OR_GPS = "wifi_or_gps"    # either signal passes. Good default.
    WIFI_REQUIRED = "wifi_required"  # must be on office WiFi. Strictest.


@dataclass(frozen=True)
class GeoCheck:
    ok: bool
    distance_m: float | None
    reason: str | None = None
    matched_wifi: bool = False


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _normalize_bssid(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().lower().replace("-", ":")


def check_presence(
    *,
    lat: float | None,
    lng: float | None,
    office_lat: float,
    office_lng: float,
    radius_m: int,
    accuracy_m: float | None = None,
    fix_age_seconds: float | None = None,
    is_mocked: bool = False,
    wifi_bssid: str | None = None,
    allowed_bssids: tuple[str, ...] = (),
    policy: PresencePolicy = PresencePolicy.WIFI_OR_GPS,
) -> GeoCheck:
    seen = _normalize_bssid(wifi_bssid)
    allowed = {_normalize_bssid(b) for b in allowed_bssids if b}
    on_office_wifi = bool(seen and seen in allowed)

    if policy is PresencePolicy.WIFI_REQUIRED and not on_office_wifi:
        return GeoCheck(False, None, "Connect to the office WiFi to check in", False)

    # Being on the office access point is proof of presence on its own - the
    # GPS reading adds nothing and would only introduce false rejects indoors.
    if on_office_wifi and policy is not PresencePolicy.GPS_ONLY:
        distance = (
            haversine_m(lat, lng, office_lat, office_lng)
            if lat is not None and lng is not None else None
        )
        return GeoCheck(True, distance, None, True)

    if lat is None or lng is None:
        return GeoCheck(False, None, "Location permission denied or unavailable", False)

    # Android will tell you the location was faked, if you ask.
    if is_mocked:
        return GeoCheck(False, None, "Mock location detected", False)

    if accuracy_m is not None and accuracy_m > MAX_ACCEPTABLE_ACCURACY_M:
        return GeoCheck(False, None, f"GPS accuracy too poor ({accuracy_m:.0f}m)", False)

    if fix_age_seconds is not None and fix_age_seconds > MAX_FIX_AGE_SECONDS:
        return GeoCheck(False, None, f"Stale location fix ({fix_age_seconds:.0f}s old)", False)

    distance = haversine_m(lat, lng, office_lat, office_lng)

    # Allow the phone's own stated margin of error, so someone at their desk
    # with a weak indoor fix is not marked absent for a day they worked.
    effective = distance - (accuracy_m or 0.0)
    if effective > radius_m:
        return GeoCheck(
            False, distance,
            f"You're about {distance:.0f}m from the office - check in from inside",
            False,
        )

    return GeoCheck(True, distance, None, False)


# Kept so existing callers and tests keep working.
def check_location(**kwargs) -> GeoCheck:
    kwargs.setdefault("policy", PresencePolicy.GPS_ONLY)
    return check_presence(**kwargs)
