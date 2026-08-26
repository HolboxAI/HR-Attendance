# AWS credentials - what this app needs, and what it must never have

Two completely different things get called "keys". They are not interchangeable.

| | What it is | Used for | Looks like |
|---|---|---|---|
| **SSH key pair** | `.pem` file downloaded when the EC2 was created | Logging into the server | `boxcode-key.pem` |
| **Access keys** | Access key ID + secret | Calling the AWS API (S3, Rekognition) | `AKIA...` + a long secret |

You cannot SSH into an EC2 with access keys. You cannot call Rekognition with
a .pem. We need both, for different jobs.

## Do NOT use a personal access key

A key downloaded as `<yourname>_accessKeys.csv` from the console is tied to a
human account and typically carries broad permissions. Putting one in an app's
.env means:

- it can do far more than compare two faces
- if the server is ever compromised, the blast radius is your whole AWS account
- rotating it breaks whatever else you use it for
- the audit trail says "Krish did this", not "the attendance app did this"

## Do this instead

1. IAM -> Users -> Create user, name it `boxcode-hrms-api`
2. No console access. Programmatic only.
3. Attach the policy in `infra/iam-policy.json`, with BUCKET replaced
4. Create an access key for it, choose "Application running on an AWS compute service"
5. Put it in the server's `.env` - never in git, never in the mobile app

That key can compare two faces and read and write one S3 bucket. Nothing else.
If it leaks, someone can identify faces and read selfies - bad, but survivable,
and revoking it breaks nothing except this app.

## Better still, once it works

The API runs on EC2, so it can use an **IAM instance role** and hold no
long-lived key at all - AWS rotates short-lived credentials automatically and
there is nothing in .env to leak. Same policy, attached to the instance instead
of a user. Worth doing before the pilot.

## Bucket settings

- Block all public access: ON
- Default encryption: SSE-S3
- Lifecycle rule: delete `punches/` objects after 90 days (see PRD retention)
- Enrolment photos live under `enrolments/` and are deleted when someone leaves
