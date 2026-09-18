"""Import historical attendance from a mapped punch CSV.

The board is derived from punches. This script inserts IN/OUT punches via
record_punch(source=IMPORT) and recomputes each day. It never matches by name.

    .venv/bin/python scripts/import_attendance.py \
        --mapping scripts/attendance_import_mapping.example.csv \
        --punches /path/to/punches.csv

    .venv/bin/python scripts/import_attendance.py \
        --mapping mapping.csv --punches punches.csv --apply

Punch CSV columns (header required):
    report_code,shift_date,in_at,out_at
  or
    emp_code,shift_date,in_at,out_at

Times are Asia/Kolkata. ISO-8601 (`2026-02-03T09:32:00`) or `HH:MM` with
shift_date. Missing in or out is allowed (half a day of evidence).

Rows that do not map to a live active employee are skipped. Leavers stay out.
"""
from __future__ import annotations

import argparse
import csv
import sys
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.models.employee import Employee  # noqa: E402
from app.models.enums import PunchDirection, PunchSource  # noqa: E402
from app.services.attendance import record_punch, recompute_day  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")


def _parse_date(raw: str) -> date:
    raw = raw.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date: {raw!r}")


def _parse_when(raw: str, shift_date: date) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    if "T" in raw or raw.count("-") >= 2 and ":" in raw:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt.astimezone(IST)
    hh, mm, *rest = raw.replace(".", ":").split(":")
    ss = int(rest[0]) if rest else 0
    return datetime.combine(shift_date, time(int(hh), int(mm), ss), tzinfo=IST)


def load_mapping(path: Path) -> dict[str, str]:
    """report_code (and optionally emp_code as key) → emp_code. Comments skipped."""
    mapping: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        # Drop comment lines so DictReader still sees the header
        rows = [line for line in fh if line.strip() and not line.lstrip().startswith("#")]
    reader = csv.DictReader(rows)
    if not reader.fieldnames:
        raise SystemExit(f"No header in {path}")
    fields = {name.strip().lower(): name for name in reader.fieldnames if name}
    report_col = fields.get("report_code")
    emp_col = fields.get("emp_code")
    if not emp_col:
        raise SystemExit("Mapping CSV needs an emp_code column. Name-only matching is refused.")
    for row in reader:
        emp_code = (row.get(emp_col) or "").strip().upper()
        if not emp_code:
            continue
        report_code = (row.get(report_col) or "").strip() if report_col else ""
        if report_code:
            mapping[report_code] = emp_code
        mapping[emp_code] = emp_code
    return mapping


def resolve_code(row: dict, mapping: dict[str, str]) -> str | None:
    lowered = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
    emp = lowered.get("emp_code", "").upper()
    report = lowered.get("report_code", "")
    if report and report in mapping:
        return mapping[report]
    if emp and emp in mapping:
        return mapping[emp]
    if emp:
        return emp
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", required=True, type=Path)
    parser.add_argument("--punches", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.mapping.exists():
        print(f"Mapping file not found: {args.mapping}")
        return 1
    if not args.punches.exists():
        print(f"Punch file not found: {args.punches}")
        print("Waiting on the senior's report. Copy the example mapping, fill emp codes,")
        print("export punches as CSV, then re-run with --apply.")
        return 1

    mapping = load_mapping(args.mapping)
    if not mapping:
        print("Mapping is empty. Fill emp_code rows before importing.")
        return 1

    db = SessionLocal()
    try:
        live = {
            e.emp_code.upper(): e
            for e in db.scalars(select(Employee).where(Employee.is_active.is_(True))).all()
        }
        skipped_inactive = []
        skipped_unmapped = []
        skipped_missing = []
        planned: list[tuple[Employee, date, datetime | None, datetime | None]] = []

        with args.punches.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if not reader.fieldnames:
                print("Punch CSV has no header.")
                return 1
            for i, row in enumerate(reader, start=2):
                code = resolve_code(row, mapping)
                if not code:
                    skipped_unmapped.append(i)
                    continue
                lowered = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
                try:
                    shift_date = _parse_date(lowered.get("shift_date") or "")
                    in_at = _parse_when(lowered.get("in_at") or lowered.get("check_in") or "", shift_date)
                    out_at = _parse_when(lowered.get("out_at") or lowered.get("check_out") or "", shift_date)
                except ValueError as exc:
                    print(f"  line {i}: {exc}")
                    skipped_unmapped.append(i)
                    continue
                emp = live.get(code.upper())
                if emp is None:
                    # Could be a leaver (inactive) or unknown code
                    any_emp = db.scalar(select(Employee).where(Employee.emp_code == code.upper()))
                    if any_emp is not None and not any_emp.is_active:
                        skipped_inactive.append((i, code, any_emp.full_name))
                    else:
                        skipped_missing.append((i, code))
                    continue
                if in_at is None and out_at is None:
                    skipped_unmapped.append(i)
                    continue
                planned.append((emp, shift_date, in_at, out_at))

        print(f"\nMapped punches: {len(planned)}")
        shown = {}
        for emp, shift_date, in_at, out_at in planned:
            shown.setdefault(emp.emp_code, emp.full_name)
            inn = in_at.strftime("%H:%M") if in_at else "-"
            out = out_at.strftime("%H:%M") if out_at else "-"
            print(f"  {emp.emp_code} {emp.full_name:<22} {shift_date}  in {inn}  out {out}")
        print("\nTargets:")
        for code, name in sorted(shown.items()):
            print(f"  {code} → {name}")

        if skipped_unmapped:
            print(f"\nSkipped (no mapping / no times): {len(skipped_unmapped)} lines")
        if skipped_inactive:
            print(f"Skipped leavers: {len(skipped_inactive)}")
            for i, code, name in skipped_inactive[:20]:
                print(f"  line {i}: {code} {name}")
        if skipped_missing:
            print(f"Skipped unknown codes: {len(skipped_missing)}")
            for i, code in skipped_missing[:20]:
                print(f"  line {i}: {code}")

        if not args.apply:
            print("\nDry-run only. Nothing was written. Re-run with --apply after you eyeball the mapping.")
            return 0

        recomputed: set[tuple[str, date]] = set()
        created = 0
        for emp, shift_date, in_at, out_at in planned:
            if in_at is not None:
                _, made = record_punch(
                    db, org_id=emp.org_id, employee=emp, event_ts=in_at,
                    source=PunchSource.IMPORT, direction=PunchDirection.IN,
                    raw={"import": "historical", "shift_date": str(shift_date)},
                )
                created += int(made)
            if out_at is not None:
                _, made = record_punch(
                    db, org_id=emp.org_id, employee=emp, event_ts=out_at,
                    source=PunchSource.IMPORT, direction=PunchDirection.OUT,
                    raw={"import": "historical", "shift_date": str(shift_date)},
                )
                created += int(made)
            recomputed.add((emp.emp_code, shift_date))

        for emp_code, shift_date in sorted(recomputed):
            emp = live[emp_code]
            recompute_day(db, emp, shift_date)
        db.commit()
        print(f"\nInserted {created} punches, recomputed {len(recomputed)} days.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
