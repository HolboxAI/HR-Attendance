"""Office location config.

These are the numbers every attendance decision hangs off, so they get their
own file rather than being buried in a settings blob.

Measured on site by Krish on 2026-08-27, standing inside the office, replacing
a Google Maps pin that turned out to be 451m away - further than the whole
200m radius, so the real building sat OUTSIDE its own geofence and nobody in
it could have punched successfully. That is exactly the failure the warning
here used to predict, and it is why a pin is not a measurement.

Still worth a proper Location Survey (the mobile app screen) before the pilot:
this is one reading from one spot, and the centre wants to be the middle of
the building rather than wherever the person happened to stand.
"""

from app.services.geofence import PresencePolicy

OFFICE = {
    "name": "Holbox - IIMA Ventures, Ahmedabad",
    "timezone": "Asia/Kolkata",

    # 23.03479 N, 72.53238 E - measured on site, not a map pin.
    "lat": 23.03479,
    "lng": 72.53238,
    "provisional": True,  # one reading, one spot - survey still pending

    # Start generous. The survey screen tells us what the building actually
    # gives us indoors, and we tighten from evidence rather than guesswork.
    "radius_m": 200,

    # Fill in from the office router, then move to WIFI_REQUIRED after the pilot.
    "allowed_bssids": (),
    "policy": PresencePolicy.WIFI_OR_GPS,
}
