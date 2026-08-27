"""Back up the database, prove the backup opens, and prune old ones.

    python scripts/backup.py                    take a backup now
    python scripts/backup.py --list             what backups exist
    python scripts/backup.py --verify <file>    restore-test an existing one
    python scripts/backup.py --restore <file> --to <path>

Every backup is verified as it is written: the copy is opened, integrity
checked, and real rows counted out of it. The PRD requires a restore to have
been tested before rollout, and the only way that stays true is if it happens
every single time rather than once, months ago, by someone who has left.

Nightly in production:

    0 2 * * *  cd /srv/boxcode/apps/api && .venv/bin/python scripts/backup.py

Note what this is NOT: a copy on the same disk as the database survives a bad
migration, a careless DELETE, or a corrupted table. It does not survive the
disk dying. Ship these to S3 before the pilot carries real attendance.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings                # noqa: E402
from app.services import backup                     # noqa: E402


def main() -> None:
    args = sys.argv[1:]

    if "--list" in args:
        rows = backup.listing()
        if not rows:
            print(f"\nNo backups yet in {settings.backup_dir}\n")
            return
        print(f"\n{len(rows)} backup(s) in {settings.backup_dir}\n")
        for path, when, size in rows:
            print(f"  {when:%Y-%m-%d %H:%M UTC}  {size / 1024 / 1024:>7.2f} MB  {path.name}")
        print()
        return

    if "--verify" in args:
        target = Path(args[args.index("--verify") + 1])
        result = backup.verify_file(target)
        print(f"\n{result.summary}")
        print(f"  tables : {result.tables}")
        for table, count in result.rows.items():
            print(f"  {table:<14} {count} rows")
        print()
        return

    if "--restore" in args:
        src = Path(args[args.index("--restore") + 1])
        if "--to" not in args:
            print("--restore needs --to <path>. Refusing to guess where.")
            sys.exit(1)
        dest = Path(args[args.index("--to") + 1])
        out = backup.restore(src, dest)
        print(f"\nRestored to {out}")
        print("Nothing was swapped in. Point DATABASE_URL at it to inspect, "
              "and move it into place yourself when you are satisfied.\n")
        return

    result = backup.create()
    print(f"\n{result.summary}")
    print(f"  tables : {result.tables}")
    for table, count in result.rows.items():
        print(f"  {table:<14} {count} rows")
    if result.note:
        print(f"\n  NOTE: {result.note}")

    pruned = backup.prune()
    if pruned:
        print(f"\n  pruned {len(pruned)} backup(s) older than "
              f"{settings.backup_retention_days} days")
    print()


if __name__ == "__main__":
    main()
