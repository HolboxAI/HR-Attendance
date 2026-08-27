"""Run: python3 tests/test_face_rekognition.py

Covers RekognitionFaceService WITHOUT an AWS account.

Every branch that decides whether a punch is accepted used to be reachable
only by having credentials and spending money, which meant the real provider
was the one path in the pipeline with no test behind it - the path about to
carry every punch at the pilot. The client is injected here, so the quality
gate, the threshold, the cost guard and the outage behaviour are all exercised
offline.

Nothing here asserts that a held-up photograph is refused. CompareFaces
answers "same face", never "live person" - see DECISIONS.md 007. A test
claiming otherwise would be asserting a promise the product deliberately does
not make.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.face import (                                # noqa: E402
    MATCH_THRESHOLD, NOT_ENROLLED, FaceUnavailable,
    RekognitionFaceService, StubFaceService, get_face_service,
)

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
OTHER = b"\xff\xd8\xff\xe0" + b"\x11" * 512 + b"\xff\xd9"

ok = True


def check(label, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"   [{'x' if good else ' '}] {label}" + ("" if good else f"  got {got!r}, want {want!r}"))


def face(confidence=99.0, sharpness=80.0, yaw=0, pitch=0, roll=0):
    return {
        "Confidence": confidence,
        "Quality": {"Sharpness": sharpness},
        "Pose": {"Yaw": yaw, "Pitch": pitch, "Roll": roll},
    }


class FakeRekognition:
    """Stands in for the boto3 client, and counts what it was asked to do."""

    def __init__(self, faces=None, matches=None, raises=None):
        self._faces = [face()] if faces is None else faces
        self._matches = matches
        self.raises = raises
        self.detect_calls = 0
        self.compare_calls = 0

    def detect_faces(self, **_):
        self.detect_calls += 1
        if self.raises:
            raise self.raises
        return {"FaceDetails": self._faces}

    def compare_faces(self, **kwargs):
        self.compare_calls += 1
        self.last_threshold = kwargs.get("SimilarityThreshold")
        if self.raises:
            raise self.raises
        return {"FaceMatches": self._matches or []}


def svc(client):
    return RekognitionFaceService("ap-south-1", client=client)


print("1. Quality gate refuses what should never reach CompareFaces")
check("no face detected", svc(FakeRekognition(faces=[])).quality_check(JPEG).matched, False)
check("two faces in frame", svc(FakeRekognition(faces=[face(), face()])).quality_check(JPEG).matched, False)
check("low confidence", svc(FakeRekognition(faces=[face(confidence=80.0)])).quality_check(JPEG).matched, False)
check("too blurry", svc(FakeRekognition(faces=[face(sharpness=5.0)])).quality_check(JPEG).matched, False)
check("head turned away", svc(FakeRekognition(faces=[face(yaw=50)])).quality_check(JPEG).matched, False)
check("pitched down", svc(FakeRekognition(faces=[face(pitch=-40)])).quality_check(JPEG).matched, False)
check("rolled", svc(FakeRekognition(faces=[face(roll=40)])).quality_check(JPEG).matched, False)
check("a good face passes", svc(FakeRekognition()).quality_check(JPEG).matched, True)

print("2. Every refusal explains itself to the person holding the phone")
for label, faces in [
    ("no face", []), ("two faces", [face(), face()]),
    ("blurry", [face(sharpness=5.0)]), ("turned away", [face(yaw=50)]),
]:
    reason = svc(FakeRekognition(faces=faces)).quality_check(JPEG).reason
    check(f"{label} has a reason", bool(reason and reason.strip()), True)
check("blurry says so", "blurry" in svc(FakeRekognition(faces=[face(sharpness=5.0)])).quality_check(JPEG).reason.lower(), True)

print("3. No reference photo is never a pass")
r = svc(FakeRekognition()).verify(enrolled_bytes=b"", selfie_bytes=JPEG)
check("refused", r.matched, False)
check("says to ask HR", r.reason, NOT_ENROLLED)
check("no similarity invented", r.similarity, None)

print("4. Cost guard: a bad selfie never reaches CompareFaces")
client = FakeRekognition(faces=[face(sharpness=2.0)])
svc(client).verify(enrolled_bytes=JPEG, selfie_bytes=OTHER)
check("quality ran", client.detect_calls, 1)
check("compare_faces NOT called", client.compare_calls, 0)

client = FakeRekognition()
svc(client).verify(enrolled_bytes=b"", selfie_bytes=JPEG)
check("no enrolment spends nothing at all", client.detect_calls + client.compare_calls, 0)

print("5. Matching")
client = FakeRekognition(matches=[{"Similarity": 97.4}])
r = svc(client).verify(enrolled_bytes=JPEG, selfie_bytes=OTHER)
check("matched", r.matched, True)
check("similarity reported", r.similarity, 97.4)
check("compare called once", client.compare_calls, 1)
check("threshold sent to AWS", client.last_threshold, MATCH_THRESHOLD)

r = svc(FakeRekognition(matches=[])).verify(enrolled_bytes=JPEG, selfie_bytes=OTHER)
check("no match refused", r.matched, False)
check("wrong-face reason", "does not match" in (r.reason or ""), True)

print("6. The threshold is enforced on our side, not just asked for")
# If Rekognition ever returns a match below the threshold we asked for, we
# still refuse it. Trusting the caller's own filter is how a threshold change
# silently stops applying.
r = svc(FakeRekognition(matches=[{"Similarity": MATCH_THRESHOLD - 5}])).verify(
    enrolled_bytes=JPEG, selfie_bytes=OTHER)
check("below threshold refused", r.matched, False)
r = svc(FakeRekognition(matches=[{"Similarity": MATCH_THRESHOLD}])).verify(
    enrolled_bytes=JPEG, selfie_bytes=OTHER)
check("exactly at threshold accepted", r.matched, True)

print("7. An AWS outage is not a failed face check")
for label, boom in [
    ("throttled", Exception("ThrottlingException")),
    ("bad credentials", Exception("UnrecognizedClientException")),
    ("network down", OSError("connection reset")),
]:
    try:
        svc(FakeRekognition(raises=boom)).verify(enrolled_bytes=JPEG, selfie_bytes=OTHER)
        check(f"{label} raises FaceUnavailable", "no exception", "FaceUnavailable")
    except FaceUnavailable:
        check(f"{label} raises FaceUnavailable", True, True)
    except Exception as exc:
        check(f"{label} raises FaceUnavailable", type(exc).__name__, "FaceUnavailable")

# The distinction that matters: an outage must never look like a verdict.
try:
    svc(FakeRekognition(raises=Exception("boom"))).verify(enrolled_bytes=JPEG, selfie_bytes=OTHER)
except FaceUnavailable:
    check("outage is not FaceResult(matched=False)", True, True)

print("8. Provider selection")
os.environ["FACE_PROVIDER"] = "stub"
from app.core.config import Settings                           # noqa: E402
check("stub by default", isinstance(get_face_service(), StubFaceService), True)
check("rekognition when asked", Settings(face_provider="rekognition").face_provider, "rekognition")

print("9. The stub still refuses what it must")
stub = StubFaceService()
check("stub refuses no-enrolment", stub.verify(b"", JPEG).reason, NOT_ENROLLED)
check("stub refuses a non-image", stub.quality_check(b"not a jpeg at all").matched, False)
check("stub labels itself in the reason", "stub" in (stub.verify(JPEG, OTHER).reason or "").lower(), True)

print("\n" + ("ALL PASS" if ok else "FAILURES ABOVE"))
sys.exit(0 if ok else 1)
