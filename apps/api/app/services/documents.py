"""Sniff medical-document bytes so Slack/email open the real file type.

Upload used to treat anything that was not application/pdf as .jpg. A PNG
or HEIC then went out as image/jpeg, and email attached it as
application/octet-stream — both of which make clients refuse to open it.
"""

from __future__ import annotations


def infer_document_kind(
    data: bytes,
    content_type: str | None = None,
    filename: str | None = None,
) -> tuple[str, str]:
    """Return (extension without dot, media_type)."""
    if data.startswith(b"%PDF"):
        return "pdf", "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data[:2] == b"\xff\xd8":
        return "jpg", "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"

    ct = (content_type or "").split(";")[0].strip().lower()
    by_ct = {
        "application/pdf": ("pdf", "application/pdf"),
        "image/png": ("png", "image/png"),
        "image/jpeg": ("jpg", "image/jpeg"),
        "image/jpg": ("jpg", "image/jpeg"),
        "image/webp": ("webp", "image/webp"),
        "image/heic": ("heic", "image/heic"),
        "image/heif": ("heif", "image/heif"),
    }
    if ct in by_ct:
        return by_ct[ct]

    name = (filename or "").rsplit(".", 1)
    if len(name) == 2:
        ext = name[1].lower()
        by_ext = {
            "pdf": ("pdf", "application/pdf"),
            "png": ("png", "image/png"),
            "jpg": ("jpg", "image/jpeg"),
            "jpeg": ("jpg", "image/jpeg"),
            "webp": ("webp", "image/webp"),
            "heic": ("heic", "image/heic"),
            "heif": ("heif", "image/heif"),
        }
        if ext in by_ext:
            return by_ext[ext]

    return "jpg", "image/jpeg"


def kind_from_storage_key(key: str, data: bytes | None = None) -> tuple[str, str]:
    """Return (extension, media_type) from a stored key, sniffing bytes if given."""
    if data:
        return infer_document_kind(data, filename=key)
    return infer_document_kind(b"", filename=key)


def email_subtype(extension: str) -> str:
    """MIMEApplication _subtype so clients get application/pdf, not octet-stream."""
    return {
        "pdf": "pdf",
        "png": "png",
        "jpg": "jpeg",
        "jpeg": "jpeg",
        "webp": "webp",
        "heic": "heic",
        "heif": "heif",
    }.get(extension.lower(), "octet-stream")
