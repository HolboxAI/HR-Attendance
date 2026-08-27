"""One place that builds AWS clients, so every caller resolves credentials
the same way.

The order matters and is deliberate:

  1. Explicit keys from settings (.env) - what a developer expects when they
     paste a key into apps/api/.env.
  2. boto3's own default chain - environment, ~/.aws/credentials, and finally
     the EC2 instance role, which is the production end state because it
     holds no long-lived secret at all.

Without step 1 the .env keys are silently ignored, because pydantic reads
.env into Settings rather than into os.environ. The preflight in
scripts/check_aws.py goes through this same function on purpose - a preflight
that resolved credentials differently from the app would happily pass while
the app used a different account.
"""

from __future__ import annotations

from app.core.config import settings


def client(service_name: str):
    import boto3  # lazy: stub-mode development never needs boto3 installed

    if settings.aws_access_key_id and settings.aws_secret_access_key:
        return boto3.client(
            service_name,
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
        )
    return boto3.client(service_name, region_name=settings.aws_region)


def credential_source() -> str:
    """For the preflight's benefit - never returns a secret value."""
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        return "explicit keys from .env / environment"
    return "boto3 default chain (~/.aws/credentials, or an IAM instance role)"
