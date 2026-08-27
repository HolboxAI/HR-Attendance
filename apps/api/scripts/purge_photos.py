"""Delete biometric data that is past its retention window.

    python scripts/purge_photos.py              show what WOULD be deleted
    python scripts/purge_photos.py --apply      actually delete it

Dry run by default, on purpose. This deletes evidence that cannot be
recovered, and the difference between "show me" and "do it" should be a word
you had to type rather than a flag you had to remember to leave off.

Run it from cron once a day in production:

    0 3 * * *  cd /srv/boxcode/apps/api && .venv/bin/python scripts/purge_photos.py --apply
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                       # noqa: E402

from app.core.config import settings                # noqa: E402
from app.db.session import SessionLocal             # noqa: E402
from app.models.org import Organization             # noqa: E402
from app.services import retention                  # noqa: E402


def main() -> None:
    apply = "--apply" in sys.argv
    db = SessionLocal()
    try:
        org = db.scalar(select(Organization))
        if org is None:
            print("No organisation yet - run scripts/seed.py first.")
            sys.exit(1)

        result = retention.run(db, org_id=org.id, dry_run=not apply)
        selfies = result["punch_selfies"]
        refs = result["reference_photos"]
        verb = "deleted" if apply else "would delete"

        print(f"\npolicy    : punch selfies kept {settings.punch_selfie_retention_days} days; "
              f"reference photos kept {settings.reference_photo_days_after_exit} days "
              f"after an employee's exit date")
        print(f"selfies   : {verb} {selfies['deleted']} file(s) "
              f"({selfies['bytes'] / 1024 / 1024:.1f} MB), taken before {selfies['cutoff']}")
        print(f"reference : {verb} {refs['deleted']} file(s) "
              f"({refs['bytes'] / 1024 / 1024:.1f} MB) belonging to people who have left")

        if not apply:
            print("\nNothing was deleted. Re-run with --apply to do it for real.\n")
        else:
            print("\nDone. The punch rows themselves are untouched - only the "
                  "images are gone, and an audit row records the sweep.\n")
    finally:
        db.close()


if __name__ == "__main__":
    main()
