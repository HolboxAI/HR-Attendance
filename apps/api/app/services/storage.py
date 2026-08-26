"""Photo storage.

Prototype writes files to disk. Production will write to S3. Callers only ever
see an opaque key like `punches/2026-08-26/<uuid>.jpg`, so the swap is one
class, not a search-and-replace through the codebase.
"""

from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

from app.core.config import settings


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        # Keys are generated internally, but a traversal check costs nothing
        # and this code will outlive the assumption that they always are.
        path = (self.root / key).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError(f"Refusing to write outside the storage root: {key}")
        return path

    def put(self, key: str, data: bytes) -> str:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    def path_for(self, key: str) -> Path:
        return self._resolve(key)


def punch_key(when: date, punch_id: uuid.UUID) -> str:
    """Foldered by date so a day's selfies can be inspected - or purged - as a unit."""
    return f"punches/{when.isoformat()}/{punch_id}.jpg"


def image_extension(data: bytes) -> str:
    """Name the file after what it actually is.

    HR uploads whatever their phone or laptop produced. Writing a PNG to a
    .jpg key is harmless to the app - the photo endpoint sniffs the magic
    bytes - but it makes data/uploads a liar to anyone browsing it.
    """
    return "png" if data.startswith(b"\x89PNG\r\n\x1a\n") else "jpg"


def enrolment_key(employee_id: uuid.UUID, version: int = 1, ext: str = "jpg") -> str:
    return f"enrolments/{employee_id}/v{version}.{ext}"


storage = LocalStorage(settings.storage_dir)
