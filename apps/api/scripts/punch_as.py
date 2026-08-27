"""One live punch, for showing someone how this works.

    python scripts/punch_as.py BX002                 Nikunj checks in
    python scripts/punch_as.py BX002 --out           ...and checks out
    python scripts/punch_as.py BX002 --from-home     refused, and kept
    python scripts/punch_as.py BX002 --fake-gps      spoofing caught
    python scripts/punch_as.py --board               who is in, right now

Unlike scripts/demo_day.py this writes to the REAL database, so whatever
happens here shows up on the dashboard a second later. That is the point: the
punch you demonstrate and the row HR sees are the same row.

It goes through the actual HTTP layer - the same routing, dependencies, device
binding, geofence, face check and resolver a phone hits. The single shortcut is
the password: the script mints an access token straight from the database
rather than asking for one, because nobody knows every colleague's password and
resetting one just to run a demo would be a silly reason to lock someone out.
Everything after that point is the real pipeline.
"""

from __future__ import annotations

import argparse
import io
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient          # noqa: E402
from sqlalchemy import select                      # noqa: E402

from app.core.office import OFFICE                 # noqa: E402
from app.core.security import create_token_pair    # noqa: E402
from app.db.session import SessionLocal            # noqa: E402
# `import app.models` must come BEFORE `from app.main import app`: it rebinds
# the name `app` to the package and would shadow the FastAPI instance.
import app.models                                  # noqa: F401,E402
from app.main import app                           # noqa: E402
from app.models.employee import Employee, User     # noqa: E402
from app.services import devices                   # noqa: E402

IST = ZoneInfo(OFFICE.get("timezone", "Asia/Kolkata"))

# A real, minimal JPEG. The stub face provider sniffs magic bytes; Rekognition
# would reject this for having no face in it, which is correct and is exactly
# what you want to see the day FACE_PROVIDER flips over.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 1024 + b"\xff\xd9"

# Somewhere in Vastrapur, comfortably outside the geofence.
HOME = (23.0195, 72.5290)

GREEN, RED, DIM, BOLD, OFF = "\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"


def find(db, code: str) -> Employee:
    emp = db.scalar(select(Employee).where(Employee.emp_code == code.upper()))
    if emp is None:
        codes = [e.emp_code for e in db.scalars(
            select(Employee).where(Employee.is_active.is_(True))
            .order_by(Employee.emp_code)).all()]
        sys.exit(f"No employee {code}. Try one of: {', '.join(codes)}")
    return emp


def show_board(client, headers) -> None:
    r = client.get("/api/v1/admin/board", headers=headers)
    if r.status_code != 200:
        print(f"  (board needs a manager or above - got {r.status_code})")
        return
    board = r.json()
    s = board["summary"]
    print(f"\n{BOLD}The board right now{OFF}   {board['shift_date']}")
    print(f"  in the office {s['currently_in']}/{s['headcount']}"
          f" · present {s['present']} · late {s['late']}"
          f" · absent {s['absent']} · exceptions {s['exceptions']}")
    def hhmm(iso: str | None) -> str:
        # The API returns UTC instants; slicing the string prints London wall
        # time and quietly disagrees with the dashboard. Same trap as the
        # board date - render in the org timezone or not at all.
        if not iso:
            return "  -  "
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt.astimezone(IST).strftime("%H:%M")

    for row in board["rows"]:
        if row["punch_count"] == 0:
            continue
        mark = "IN " if row["currently_in"] else "   "
        note = f'  {row["exception_note"]}' if row.get("exception_note") else ""
        print(f"  {mark} {row['employee_code']}  {row['full_name']:<16}"
              f" {row['status']:<11} {hhmm(row['first_in'])} -> {hhmm(row['last_out'])}{note}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("employee_code", nargs="?", help="e.g. BX002")
    ap.add_argument("--out", action="store_true", help="check out instead of in")
    ap.add_argument("--from-home", action="store_true", help="punch from outside the geofence")
    ap.add_argument("--fake-gps", action="store_true", help="pretend the phone is spoofing")
    ap.add_argument("--board", action="store_true", help="just show the board")
    args = ap.parse_args()

    db = SessionLocal()
    client = TestClient(app)

    if args.board or not args.employee_code:
        admin = db.scalar(select(User).where(User.role.in_(("super_admin", "hr_admin"))))
        pair = create_token_pair(user_id=admin.id, role=admin.role.value,
                                 employee_id=admin.employee_id)
        show_board(client, {"Authorization": f"Bearer {pair.access_token}"})
        db.close()
        return

    emp = find(db, args.employee_code)
    user = db.scalar(select(User).where(User.employee_id == emp.id))
    if user is None:
        sys.exit(f"{emp.emp_code} {emp.full_name} has no login account")

    install_id = f"demo-handset-{emp.emp_code.lower()}"
    # Bind the handset the way a first sign-in on a new phone would. Without
    # this the punch is refused, which is the feature working, not a bug.
    result = devices.bind(db, employee=emp, install_id=install_id,
                          platform="ios", model="Demo iPhone")
    if not result.ok:
        print(f"{DIM}  (handset already bound elsewhere: {result.reason}){OFF}")
    db.commit()

    pair = create_token_pair(user_id=user.id, role=user.role.value,
                             employee_id=user.employee_id)
    headers = {"Authorization": f"Bearer {pair.access_token}",
               "X-Install-Id": install_id}

    lat, lng = (HOME if args.from_home else (OFFICE["lat"], OFFICE["lng"]))
    where = "from home" if args.from_home else "at the office"
    if args.fake_gps:
        where = "with a spoofed location"

    print(f"\n{BOLD}{emp.full_name}{OFF} ({emp.emp_code}) is punching "
          f"{'OUT' if args.out else 'IN'} {where}")
    print(f"{DIM}  handset {install_id} · {lat}, {lng} "
          f"· {datetime.now(IST):%H:%M:%S}{OFF}")
    # Without this line, "the terminal passed but the camera page refused me"
    # is the first question everyone asks. The camera page reads the real GPS;
    # this script CLAIMS coordinates, which is its job as a demo tool.
    print(f"{DIM}  location is SIMULATED - this script claims the coordinates "
          f"above. The check-in page uses your real GPS.{OFF}")

    r = client.post(
        "/api/v1/mobile/punch",
        headers=headers,
        files={"selfie": ("selfie.jpg", io.BytesIO(JPEG), "image/jpeg")},
        data={
            "lat": str(lat), "lng": str(lng), "accuracy_m": "12",
            "is_mocked": "true" if args.fake_gps else "false",
            # Only sent when forced. Left to itself the server alternates from
            # the last accepted punch, exactly like the phone - and forcing
            # "in" here is how the demo once produced a double-IN whose owner
            # the board then reported as absent from the building.
            **({"direction": "out"} if args.out else {}),
        },
    )

    if r.status_code != 200:
        print(f"{RED}  HTTP {r.status_code}{OFF}  {r.text[:200]}")
        db.close()
        sys.exit(1)

    body = r.json()
    if body["accepted"]:
        print(f"{GREEN}  ACCEPTED{OFF}  {body['message']}")
        if body.get("worked_minutes"):
            h, m = divmod(body["worked_minutes"], 60)
            print(f"            worked so far: {h}h{m:02d}"
                  f"   status: {body.get('attendance_status')}")
    else:
        print(f"{RED}  REFUSED{OFF}   {body['message']}")
        if body.get("distance_m") is not None:
            print(f"            {body['distance_m']:.0f}m from the office")
        print(f"{DIM}            Stored anyway, with the reason. Nothing is "
              f"dropped silently.{OFF}")

    # Which day did that punch belong to? Before 05:30 IST the answer is not
    # obvious, and "accepted in the terminal, invisible on the board" was a
    # real afternoon lost to exactly this.
    from app.services.attendance import policy_for
    from app.services.resolver import shift_date_for
    policy, _ = policy_for(db, emp, datetime.now(IST).date())
    filed = shift_date_for(datetime.now(ZoneInfo("UTC")), policy)
    print(f"{DIM}            filed to the {filed} attendance day{OFF}")

    admin = db.scalar(select(User).where(User.role.in_(("super_admin", "hr_admin"))))
    apair = create_token_pair(user_id=admin.id, role=admin.role.value,
                              employee_id=admin.employee_id)
    show_board(client, {"Authorization": f"Bearer {apair.access_token}"})
    print(f"\n{DIM}Same rows on the dashboard: "
          f"http://localhost:3000/board?on={filed}{OFF}\n")
    db.close()


if __name__ == "__main__":
    main()
