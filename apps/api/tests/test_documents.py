"""Run: python3 tests/test_documents.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.documents import email_subtype, infer_document_kind, kind_from_storage_key

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok &= good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")


print("1. Magic-byte sniffing")
check("pdf", infer_document_kind(b"%PDF-1.4 rest"), ("pdf", "application/pdf"))
check("png", infer_document_kind(b"\x89PNG\r\n\x1a\nrest"), ("png", "image/png"))
check("jpeg", infer_document_kind(b"\xff\xd8\xffrest"), ("jpg", "image/jpeg"))
check("webp", infer_document_kind(b"RIFF....WEBP...."), ("webp", "image/webp"))

print("2. Content-type fallback when bytes are generic")
check(
    "png via content-type",
    infer_document_kind(b"not-magic", content_type="image/png"),
    ("png", "image/png"),
)
check(
    "pdf via content-type",
    infer_document_kind(b"not-magic", content_type="application/pdf; charset=binary"),
    ("pdf", "application/pdf"),
)

print("3. Storage key + email subtype")
check(
    "stored png",
    kind_from_storage_key("medical_docs/x/doc.png"),
    ("png", "image/png"),
)
check("email pdf", email_subtype("pdf"), "pdf")
check("email jpg", email_subtype("jpg"), "jpeg")
check("email png", email_subtype("png"), "png")

print()
print("ALL PASSED" if ok else "FAILED")
sys.exit(0 if ok else 1)
