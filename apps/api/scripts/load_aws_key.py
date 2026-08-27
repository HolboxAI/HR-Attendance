"""Load an AWS access key from the CSV the console gives you, into .env.

    python scripts/load_aws_key.py ~/Downloads/acces-krrish-aws.csv
    python scripts/load_aws_key.py            # searches ~/Downloads

Exists so the secret goes from the download straight into .env without being
retyped, pasted into a chat, or read aloud - every one of which leaves a copy
somewhere it should not be. Prints lengths and the key ID prefix, never the
secret.

Handles both CSV layouts the console has used: the two-column
"Access key ID,Secret access key" and the wider one that also carries a user
name and console link.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

ENV = Path(__file__).resolve().parents[1] / ".env"


def find_csv() -> Path:
    if len(sys.argv) > 1:
        p = Path(sys.argv[1]).expanduser()
        if not p.is_file():
            sys.exit(f"No such file: {p}")
        return p
    downloads = Path.home() / "Downloads"
    hits = sorted(
        (p for p in downloads.glob("*.csv")
         if any(w in p.name.lower() for w in ("access", "acces", "key", "aws", "credential"))),
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    if not hits:
        sys.exit(f"No likely key CSV in {downloads}. Pass the path explicitly.")
    return hits[0]


def read_key(path: Path) -> tuple[str, str]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        sys.exit(f"{path.name} has no rows in it.")
    row = rows[0]
    # Column names have varied across console versions; match loosely.
    key_id = secret = ""
    for name, value in row.items():
        low = (name or "").strip().lower()
        if "access key id" in low:
            key_id = (value or "").strip()
        elif "secret" in low:
            secret = (value or "").strip()
    if not key_id or not secret:
        sys.exit(f"Could not find both columns in {path.name}.\n"
                 f"Columns were: {', '.join(n for n in row if n)}")
    return key_id, secret


def write_env(key_id: str, secret: str) -> None:
    lines = ENV.read_text().splitlines() if ENV.is_file() else []
    wanted = {"AWS_ACCESS_KEY_ID": key_id, "AWS_SECRET_ACCESS_KEY": secret}
    seen = set()
    out = []
    for line in lines:
        name = line.split("=", 1)[0].strip() if "=" in line else ""
        if name in wanted:
            out.append(f"{name}={wanted[name]}")
            seen.add(name)
        else:
            out.append(line)
    for name, value in wanted.items():
        if name not in seen:
            out.append(f"{name}={value}")
    ENV.write_text("\n".join(out) + "\n")


def main() -> None:
    path = find_csv()
    key_id, secret = read_key(path)
    print(f"\n  from   : {path.name}")
    print(f"  key id : {key_id[:8]}...  ({len(key_id)} chars)")
    print(f"  secret : {'*' * 12}      ({len(secret)} chars)")

    if len(key_id) != 20 or len(secret) != 40:
        print("\n  [!] AWS issues 20-character key IDs and 40-character secrets.")
        print("      These look wrong - the download may be truncated.")

    write_env(key_id, secret)
    print(f"\n  written to {ENV}")
    print("  next: .venv/bin/python scripts/check_aws.py\n")

    print("  Delete the CSV once this works - a key sitting in Downloads is a")
    print("  key in your backups, your cloud sync and anything that indexes it:")
    print(f"      rm {path}\n")


if __name__ == "__main__":
    main()
