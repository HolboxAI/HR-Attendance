"""Run: python3 tests/test_geofence.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.geofence import (PresencePolicy, check_location,
                                    check_presence, haversine_m)

OFFICE = dict(office_lat=12.9716, office_lng=77.5946, radius_m=150)
ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


print("1. Known distance sanity (Bangalore -> Chennai great-circle is ~290km)")
d = haversine_m(12.9716, 77.5946, 13.0827, 80.2707)
check("within 5km of 290km", 285_000 < d < 295_000, True)

print("2. Standing at the office")
r = check_location(lat=12.9716, lng=77.5946, accuracy_m=10, **OFFICE)
check("accepted", r.ok, True)
check("distance ~0m", round(r.distance_m) == 0, True)

print("3. At the office gate, 120m out")
r = check_location(lat=12.9727, lng=77.5946, accuracy_m=15, **OFFICE)
check("accepted (inside 150m)", r.ok, True)

print("4. Punching from home, 3km away")
r = check_location(lat=12.9986, lng=77.5946, accuracy_m=10, **OFFICE)
check("rejected", r.ok, False)
check("reason mentions distance", "from the office" in (r.reason or ""), True)

print("5. Just outside, but the phone's own margin covers it -> benefit of the doubt")
r = check_location(lat=12.9731, lng=77.5946, accuracy_m=60, **OFFICE)
check("distance is over 150m", r.distance_m > 150, True)
check("still accepted", r.ok, True)

print("6. Faked GPS")
r = check_location(lat=12.9716, lng=77.5946, accuracy_m=5, is_mocked=True, **OFFICE)
check("rejected", r.ok, False)
check("reason", r.reason, "Mock location detected")

print("7. Useless accuracy -> cannot conclude anything")
r = check_location(lat=12.9716, lng=77.5946, accuracy_m=800, **OFFICE)
check("rejected", r.ok, False)

print("8. Stale fix from 10 minutes ago")
r = check_location(lat=12.9716, lng=77.5946, accuracy_m=10, fix_age_seconds=600, **OFFICE)
check("rejected", r.ok, False)

print("9. Location permission denied")
r = check_location(lat=None, lng=None, **OFFICE)
check("rejected", r.ok, False)

OFFICE_WIFI = ("A4:2B:8C:11:22:33",)
STRICT = dict(OFFICE, allowed_bssids=OFFICE_WIFI)

print("10. On the office WiFi -> in the office, GPS irrelevant")
r = check_presence(lat=12.9716, lng=77.5946, accuracy_m=45,
                   wifi_bssid="a4:2b:8c:11:22:33",
                   policy=PresencePolicy.WIFI_OR_GPS, **STRICT)
check("accepted", r.ok, True)
check("matched_wifi", r.matched_wifi, True)

print("11. BSSID case and dash formatting is normalised")
r = check_presence(lat=12.9716, lng=77.5946, wifi_bssid="A4-2B-8C-11-22-33",
                   policy=PresencePolicy.WIFI_OR_GPS, **STRICT)
check("accepted", r.ok, True)

print("12. Home WiFi, but standing near the office -> GPS still lets them in")
r = check_presence(lat=12.9716, lng=77.5946, accuracy_m=10,
                   wifi_bssid="ff:ff:ff:00:00:01",
                   policy=PresencePolicy.WIFI_OR_GPS, **STRICT)
check("accepted via GPS", r.ok, True)
check("not via wifi", r.matched_wifi, False)

print("13. WIFI_REQUIRED: car park, right coordinates, wrong network -> refused")
r = check_presence(lat=12.9716, lng=77.5946, accuracy_m=5,
                   wifi_bssid="ff:ff:ff:00:00:01",
                   policy=PresencePolicy.WIFI_REQUIRED, **STRICT)
check("rejected", r.ok, False)
check("reason", r.reason, "Connect to the office WiFi to check in")

print("14. WIFI_REQUIRED: spoofed GPS cannot help you")
r = check_presence(lat=12.9716, lng=77.5946, is_mocked=True, wifi_bssid=None,
                   policy=PresencePolicy.WIFI_REQUIRED, **STRICT)
check("rejected", r.ok, False)

print("15. WIFI_REQUIRED: on office WiFi with no GPS at all -> accepted")
r = check_presence(lat=None, lng=None, wifi_bssid="a4:2b:8c:11:22:33",
                   policy=PresencePolicy.WIFI_REQUIRED, **STRICT)
check("accepted", r.ok, True)

print()
print("ALL PASS" if ok else "SOME FAILED")
sys.exit(0 if ok else 1)
