#!/usr/bin/env python3
"""Fake gate reader.

Speaks the same ADMS protocol a real ZKTeco/eSSL unit speaks, so the whole
attendance pipeline can be built and tested before anyone buys hardware.
When the real device arrives, we point it at the same URL and delete nothing.

  python3 tools/simulator/fake_gate.py --day 2026-08-24 --staff 8
  python3 tools/simulator/fake_gate.py --live          # punch every few seconds
  python3 tools/simulator/fake_gate.py --replay-outage # dump 3 buffered days at once
"""
import argparse
import random
import time
import urllib.request
from datetime import datetime, date, timedelta

SN = "SIM0000001"


def post(base: str, lines: list[str]) -> str:
    url = f"{base}/iclock/cdata?SN={SN}&table=ATTLOG"
    body = "\r\n".join(lines).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "text/plain"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read().decode()
    except Exception as e:                      # noqa: BLE001
        return f"ERROR: {e}"


def line(user_id: int, when: datetime) -> str:
    return f"{user_id}\t{when:%Y-%m-%d %H:%M:%S}\t1\t1\t0\t0"


def workday(user_id: int, d: date) -> list[str]:
    """A believable day: arrive near 9, lunch, leave near 6. Some chaos."""
    arrive = datetime.combine(d, datetime.min.time()) + timedelta(
        hours=9, minutes=random.randint(-12, 55))
    lunch_out = arrive + timedelta(hours=random.randint(3, 4), minutes=random.randint(0, 40))
    lunch_in = lunch_out + timedelta(minutes=random.randint(25, 65))
    leave = lunch_in + timedelta(hours=random.randint(4, 5), minutes=random.randint(0, 40))

    events = [arrive, lunch_out, lunch_in, leave]
    roll = random.random()
    if roll < 0.10:
        events = events[:-1]                    # forgot to punch out
    elif roll < 0.16:
        events = [arrive]                       # only one punch all day
    elif roll < 0.20:
        events.append(events[-1] + timedelta(seconds=3))   # double-tapped the reader
    return [line(user_id, e) for e in events]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--staff", type=int, default=8)
    ap.add_argument("--day", default=date.today().isoformat())
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--replay-outage", action="store_true")
    args = ap.parse_args()

    if args.live:
        print("Live mode - a punch every few seconds. Ctrl-C to stop.")
        while True:
            uid = random.randint(1, args.staff)
            print(post(args.base, [line(uid, datetime.now())]), f"user={uid}")
            time.sleep(random.randint(2, 6))

    if args.replay_outage:
        start = date.fromisoformat(args.day) - timedelta(days=2)
        lines: list[str] = []
        for offset in range(3):
            d = start + timedelta(days=offset)
            for uid in range(1, args.staff + 1):
                lines += workday(uid, d)
        print(f"Device was offline 3 days. Dumping {len(lines)} buffered punches at once.")
        print(post(args.base, lines))
        print("Send it twice - the dedupe hash should make the second one a no-op.")
        print(post(args.base, lines))
        return

    d = date.fromisoformat(args.day)
    lines = [ln for uid in range(1, args.staff + 1) for ln in workday(uid, d)]
    print(f"{len(lines)} punches for {args.staff} staff on {d}")
    print(post(args.base, lines))


if __name__ == "__main__":
    main()
