"""Office location config.

These are the numbers every attendance decision hangs off, so they get their
own file rather than being buried in a settings blob.

PROVISIONAL - supplied from Google Maps, not yet confirmed on site. Before the
pilot, run the Location Survey screen in the mobile app from inside the office
and replace these with a real reading. A map pin can sit 100m off the building
you actually work in, and 100m is most of the geofence.
"""

from app.services.geofence import PresencePolicy

OFFICE = {
    "name": "Boxcode - IIMA Ventures, Ahmedabad",
    "timezone": "Asia/Kolkata",

    # 23.0315 N, 72.5298 E  (Vastrapur, Ahmedabad)
    "lat": 23.0315,
    "lng": 72.5298,
    "provisional": True,

    # Start generous. The survey screen tells us what the building actually
    # gives us indoors, and we tighten from evidence rather than guesswork.
    "radius_m": 200,

    # Fill in from the office router, then move to WIFI_REQUIRED after the pilot.
    "allowed_bssids": (),
    "policy": PresencePolicy.WIFI_OR_GPS,
}
