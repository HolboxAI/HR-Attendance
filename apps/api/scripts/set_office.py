"""Show or change the office location and geofence radius.

    python scripts/set_office.py                          show current
    python scripts/set_office.py --radius 50000           testing: accept punches from anywhere nearby
    python scripts/set_office.py --lat 23.0315 --lng 72.5298 --radius 150
    python scripts/set_office.py --reset                  back to the configured office

The punch endpoint reads these from the database, so a change takes effect on
the next punch - no restart, no code edit.

Use --radius to demo from home. Put it back before anyone real uses the system:
a 50km radius is not a geofence, it is a formality.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                    # noqa: E402

from app.core.office import OFFICE               # noqa: E402
from app.db.session import SessionLocal          # noqa: E402
from app.models.org import Location              # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lng", type=float)
    ap.add_argument("--radius", type=int)
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        loc = db.scalar(select(Location))
        if loc is None:
            print("No location in the database. Run scripts/seed.py first.")
            return

        def show(prefix: str) -> None:
            warn = ""
            if loc.geofence_radius_m > 1000:
                warn = "   <-- WIDE. Testing only; put it back before anyone uses this."
            print(f"{prefix}  {loc.name}")
            print(f"          {loc.lat}, {loc.lng}   radius {loc.geofence_radius_m}m{warn}")

        if not any([args.lat, args.lng, args.radius, args.reset]):
            show("current:")
            return

        show("before: ")

        if args.reset:
            loc.lat, loc.lng = OFFICE["lat"], OFFICE["lng"]
            loc.geofence_radius_m = int(OFFICE["radius_m"])
        else:
            if args.lat is not None:
                loc.lat = args.lat
            if args.lng is not None:
                loc.lng = args.lng
            if args.radius is not None:
                loc.geofence_radius_m = args.radius

        db.commit()
        db.refresh(loc)
        show("after:  ")
        print("\nTakes effect on the next punch. No restart needed.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
