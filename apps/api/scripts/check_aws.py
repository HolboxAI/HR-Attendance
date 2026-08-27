"""Preflight for FACE_PROVIDER=rekognition. Run: python3 scripts/check_aws.py

Answers three questions, in the order they actually go wrong:

  1. WHICH credentials am I using?   Not "are there any" - which. The most
     likely mistake is a personal access key rather than the scoped
     boxcode-hrms-api user, and that difference is invisible until the day it
     leaks. GetCallerIdentity needs no IAM permission, so this works even if
     the policy is wrong.
  2. Can I reach Rekognition at all?  Distinguishes a credentials problem from
     a permissions problem from a bad test image - three failures that all
     look like "it didn't work" from the outside.
  3. Does a real CompareFaces round trip work?  Optional, needs two images.

Prints no secret values, ever. Not the key, not the secret, not the session
token - only the ARN, which is an identifier and not a credential.

    python3 scripts/check_aws.py
    python3 scripts/check_aws.py --enrolled ref.jpg --selfie me.jpg
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.config import settings  # noqa: E402

TICK, CROSS, WARN = "  [x]", "  [ ]", "  [!]"


def fail(message: str, fix: str | None = None) -> None:
    print(f"{CROSS} {message}")
    if fix:
        print(f"      fix: {fix}")
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--enrolled", type=Path, help="reference photo")
    ap.add_argument("--selfie", type=Path, help="photo to compare against it")
    args = ap.parse_args()

    print("\nBoxcode - AWS preflight\n" + "-" * 60)

    print(f"\n1. Configuration")
    print(f"      FACE_PROVIDER = {settings.face_provider}")
    print(f"      AWS_REGION    = {settings.aws_region}")
    if settings.face_provider != "rekognition":
        print(f"{WARN} FACE_PROVIDER is not 'rekognition', so the app is still")
        print(f"      using the stub. This script will keep checking AWS anyway.")

    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError
    except ImportError:
        fail("boto3 is not installed", ".venv/bin/pip install -r requirements.txt")

    print("\n2. Which credentials are these?")
    # Through the app's own resolver, not boto3 directly. A preflight that
    # resolved credentials differently could pass while the app quietly used
    # another account.
    from app.core.aws import client as build_client, credential_source

    print(f"      source: {credential_source()}")
    try:
        who = build_client("sts").get_caller_identity()
    except NoCredentialsError:
        fail("No credentials found at all",
             "put AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in apps/api/.env")
    except (ClientError, BotoCoreError) as exc:
        fail(f"Credentials were rejected: {type(exc).__name__}",
             "check the key is active in IAM and was copied whole")

    arn = who["Arn"]
    print(f"{TICK} Authenticated as {arn}")

    # The whole point of docs/AWS-CREDENTIALS.md, checked rather than trusted.
    if ":user/" in arn:
        user = arn.rsplit("/", 1)[-1]
        if user == "boxcode-hrms-api":
            print(f"{TICK} That is the dedicated app user, as intended")
        else:
            print(f"{WARN} IAM user is '{user}', not 'boxcode-hrms-api'.")
            print( "      If this is your personal key, a leak exposes your whole")
            print( "      account rather than just face-compare + one bucket.")
            print( "      See docs/AWS-CREDENTIALS.md.")
    elif ":assumed-role/" in arn:
        print(f"{TICK} Using an instance role - no long-lived key to leak. Ideal.")

    print("\n3. Can this key actually call Rekognition?")
    rek = build_client("rekognition")
    probe = args.selfie.read_bytes() if args.selfie and args.selfie.is_file() else b"not-an-image"
    try:
        rek.detect_faces(Image={"Bytes": probe}, Attributes=["DEFAULT"])
        print(f"{TICK} DetectFaces succeeded")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "AccessDeniedException":
            fail("Reachable, but this key is NOT allowed to call Rekognition",
                 "attach infra/iam-policy.json to the user (replace BUCKET)")
        if code in {"InvalidImageFormatException", "ImageTooLargeException",
                    "InvalidParameterException"}:
            # The call was authorised and reached the service. That is what
            # this step is testing; the image was only ever the vehicle.
            print(f"{TICK} Authorised and reachable ({code} on the probe image is expected)")
        else:
            fail(f"Rekognition returned {code or type(exc).__name__}")
    except BotoCoreError as exc:
        fail(f"Could not reach Rekognition: {type(exc).__name__}",
             "check network access and that AWS_REGION is a real region")

    if not (args.enrolled and args.selfie):
        print("\n4. Face comparison - skipped")
        print("      Pass --enrolled and --selfie to run a real CompareFaces.")
        print("\n" + "-" * 60)
        print("Credentials and Rekognition access are good.\n")
        return

    print("\n4. A real face comparison")
    for label, path in (("enrolled", args.enrolled), ("selfie", args.selfie)):
        if not path.is_file():
            fail(f"No such file for --{label}: {path}")
        print(f"      {label}: {path.name} ({path.stat().st_size / 1024:.0f} KB)")

    from app.services.face import FaceUnavailable, RekognitionFaceService

    service = RekognitionFaceService(settings.aws_region)
    try:
        result = service.verify(
            enrolled_bytes=args.enrolled.read_bytes(),
            selfie_bytes=args.selfie.read_bytes(),
        )
    except FaceUnavailable as exc:
        fail(f"Rekognition was unreachable mid-comparison: {exc}")

    if result.matched:
        print(f"{TICK} MATCH - similarity {result.similarity:.1f} "
              f"(threshold {service and 90.0})")
    else:
        print(f"{CROSS} NO MATCH - {result.reason}")
        if result.similarity is not None:
            print(f"      similarity was {result.similarity:.1f}")

    print("\n" + "-" * 60)
    print("Done. Two photos of the same person should score well above 90;")
    print("two different people typically land far below it.\n")


if __name__ == "__main__":
    main()
