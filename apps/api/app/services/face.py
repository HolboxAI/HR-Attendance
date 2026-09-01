"""Face verification via AWS Rekognition.

We do 1:1 verification, not 1:N search. The employee is already logged in, so
we only ever ask "is this the same person as their enrolled photo?" - which is
far more accurate, far cheaper, and does not degrade as headcount grows.

Cost at Boxcode's size: ~60 staff x 2 punches x 22 days = ~2,600 calls/month,
about $2.60. Not worth optimising.

Set FACE_PROVIDER=stub to develop without AWS credentials.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings

# Rekognition's own similarity scale is 0-100.
MATCH_THRESHOLD = 90.0

# Reject a selfie before spending money on it.
MIN_FACE_CONFIDENCE = 95.0
MIN_SHARPNESS = 20.0
MAX_POSE_DEGREES = 35.0


# Said to the employee, and stored as the rejection reason. Kept in one place
# because the enrolment screen greps for it to count who still needs a photo.
NOT_ENROLLED = "No reference photo on file - ask HR to enrol your face"


def _error_code(exc: Exception) -> str:
    """Rekognition's error code, or "" for anything that is not a ClientError.

    Read defensively rather than through botocore's types, so this module
    still imports and behaves on a machine with no boto3 installed - which is
    every developer running FACE_PROVIDER=stub.
    """
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        return str(response.get("Error", {}).get("Code", ""))
    return ""


def _looks_like_an_image(data: bytes) -> bool:
    return data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")


# Rekognition error codes that mean "the image you sent is not usable",
# not "the service is having a bad day". The distinction decides whether a
# punch is REFUSED or waved through with the check recorded as not performed,
# so getting it wrong in the generous direction accepts anything unparseable.
CLIENT_IMAGE_ERRORS = frozenset({
    "InvalidImageFormatException",     # not a JPEG/PNG, or corrupt
    "ImageTooLargeException",
    "InvalidParameterException",       # Rekognition's "no face in this image"
    "InvalidS3ObjectException",
})


class FaceUnavailable(Exception):
    """Rekognition could not be reached, or refused to answer.

    Deliberately NOT a FaceResult(matched=False). "The provider says this is
    the wrong face" and "we never got an answer" are different facts, and
    collapsing them would write face_ok=False into punch_events for an outage
    on our side - a permanent record accusing someone of failing a check that
    never ran.
    """


@dataclass(frozen=True)
class FaceResult:
    matched: bool
    similarity: float | None
    reason: str | None = None


class StubFaceService:
    """Passes any selfie, but only against a real enrolled photo.

    For local development and tests. Note what it still refuses: a punch with
    nothing to compare against. Returning matched=True there would write
    face_ok=True into punch_events on evidence that does not exist, which is
    worse than having no face check at all - it manufactures a record that
    would be quoted back in a dispute.
    """

    def quality_check(self, image_bytes: bytes) -> FaceResult:
        if not image_bytes:
            return FaceResult(False, None, "No image supplied")
        if not _looks_like_an_image(image_bytes):
            return FaceResult(False, None, "That file is not a JPEG or PNG")
        return FaceResult(True, None)

    def verify(self, enrolled_bytes: bytes, selfie_bytes: bytes) -> FaceResult:
        if not selfie_bytes:
            return FaceResult(False, None, "No image supplied")
        if not enrolled_bytes:
            return FaceResult(False, None, NOT_ENROLLED)
        return FaceResult(True, 99.0, "stub provider - not a real match")

    def same_person(self, reference_bytes: bytes, candidate_bytes: bytes) -> FaceResult:
        """Identical bytes are provably the same photo; that much the stub can
        assert without a face model, so the lazy version of the loophole - an
        employee re-uploading someone else's exact image file - is caught even
        in development. Different bytes get the stub's usual benefit of the
        doubt (matched=False here means "no duplicate found", the permissive
        answer)."""
        if not reference_bytes or not candidate_bytes:
            return FaceResult(False, None)
        if reference_bytes == candidate_bytes:
            return FaceResult(True, 100.0, "identical image bytes")
        return FaceResult(False, None)


class RekognitionFaceService:
    def __init__(self, region: str, client=None) -> None:
        if client is not None:
            # Injected by the tests. Every branch below is reachable without
            # an AWS account, which is the only way this path gets covered
            # before it goes live rather than after.
            self._client = client
            return
        # Aliased: the parameter above is also called `client`, and rebinding
        # it here would shadow it in a way that reads like a bug.
        from app.core.aws import client as build_client  # lazy import

        self._client = build_client("rekognition")

    def quality_check(self, image_bytes: bytes) -> FaceResult:
        """Catch the obvious failures locally-ish, before CompareFaces."""
        try:
            resp = self._client.detect_faces(
                Image={"Bytes": image_bytes}, Attributes=["DEFAULT"]
            )
        except Exception as exc:
            code = _error_code(exc)
            if code in CLIENT_IMAGE_ERRORS:
                # The employee's own submission is unusable. That is a refusal
                # with a reason, not an outage - treating it as an outage let a
                # 1KB file of zeroes through as "face check not performed".
                return FaceResult(False, None, "That photo could not be read - try again")
            raise FaceUnavailable(f"{code or type(exc).__name__}: {exc}") from exc
        faces = resp.get("FaceDetails", [])
        if not faces:
            return FaceResult(False, None, "No face detected - move into better light")
        if len(faces) > 1:
            return FaceResult(False, None, "More than one face in frame")

        face = faces[0]
        if face["Confidence"] < MIN_FACE_CONFIDENCE:
            return FaceResult(False, None, "Face unclear - try again")
        if face.get("Quality", {}).get("Sharpness", 100) < MIN_SHARPNESS:
            return FaceResult(False, None, "Photo too blurry")

        pose = face.get("Pose", {})
        if any(abs(pose.get(k, 0)) > MAX_POSE_DEGREES for k in ("Yaw", "Pitch", "Roll")):
            return FaceResult(False, None, "Look straight at the camera")

        return FaceResult(True, None)

    def verify(self, enrolled_bytes: bytes, selfie_bytes: bytes) -> FaceResult:
        if not enrolled_bytes:
            return FaceResult(False, None, NOT_ENROLLED)

        quality = self.quality_check(selfie_bytes)
        if not quality.matched:
            return quality

        try:
            resp = self._client.compare_faces(
                SourceImage={"Bytes": enrolled_bytes},
                TargetImage={"Bytes": selfie_bytes},
                SimilarityThreshold=MATCH_THRESHOLD,
            )
        except Exception as exc:
            code = _error_code(exc)
            if code in CLIENT_IMAGE_ERRORS:
                return FaceResult(False, None, "That photo could not be read - try again")
            raise FaceUnavailable(f"{code or type(exc).__name__}: {exc}") from exc
        matches = resp.get("FaceMatches", [])
        if not matches:
            return FaceResult(False, None, "Face does not match the enrolled photo")

        similarity = matches[0]["Similarity"]
        return FaceResult(similarity >= MATCH_THRESHOLD, similarity)

    def same_person(self, reference_bytes: bytes, candidate_bytes: bytes) -> FaceResult:
        """Is the candidate photo the same face as an EXISTING reference photo?

        Used by the enrolment duplicate sweep, not the punch path. No quality
        gate here - the caller has already quality-checked the candidate, and
        re-running DetectFaces once per existing enrolment would multiply the
        cost of every enrolment for nothing.
        """
        if not reference_bytes or not candidate_bytes:
            return FaceResult(False, None)
        try:
            resp = self._client.compare_faces(
                SourceImage={"Bytes": reference_bytes},
                TargetImage={"Bytes": candidate_bytes},
                SimilarityThreshold=MATCH_THRESHOLD,
            )
        except Exception as exc:
            code = _error_code(exc)
            if code in CLIENT_IMAGE_ERRORS:
                # One stored reference is unreadable (rotted file, no face).
                # That says nothing about the candidate - skip this reference
                # rather than blocking the whole enrolment on it.
                return FaceResult(False, None)
            raise FaceUnavailable(f"{code or type(exc).__name__}: {exc}") from exc
        matches = resp.get("FaceMatches", [])
        if not matches:
            return FaceResult(False, None)
        similarity = matches[0]["Similarity"]
        return FaceResult(similarity >= MATCH_THRESHOLD, similarity)


def get_face_service():
    if settings.face_provider == "rekognition":
        return RekognitionFaceService(settings.aws_region)
    return StubFaceService()
