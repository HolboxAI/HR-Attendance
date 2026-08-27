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


def _looks_like_an_image(data: bytes) -> bool:
    return data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")


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
        except Exception as exc:  # boto raises a wide family; all mean the same here
            raise FaceUnavailable(str(exc)) from exc
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
            raise FaceUnavailable(str(exc)) from exc
        matches = resp.get("FaceMatches", [])
        if not matches:
            return FaceResult(False, None, "Face does not match the enrolled photo")

        similarity = matches[0]["Similarity"]
        return FaceResult(similarity >= MATCH_THRESHOLD, similarity)


def get_face_service():
    if settings.face_provider == "rekognition":
        return RekognitionFaceService(settings.aws_region)
    return StubFaceService()
