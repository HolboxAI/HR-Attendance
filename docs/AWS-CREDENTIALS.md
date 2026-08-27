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
3. Attach the policy in `infra/iam-policy.json` — as-is, nothing to replace.
   It is two Rekognition actions and nothing else, which is the whole AWS
   surface of the app. S3 permissions live in `infra/iam-policy-s3-later.json`
   and are deliberately NOT requested yet: photo storage is local disk today,
   and asking for permissions the code does not use is how a least-privilege
   request stops being believed.
4. Create an access key for it, choose "Application running on an AWS compute service"
5. Put it in the server's `.env` - never in git, never in the mobile app

That key can compare two faces. Nothing else - it cannot read a bucket, list
your account, or touch any other service. If it leaks, someone can spend your
money on face comparisons, and revoking it breaks nothing except this app.

Note on `Resource: "*"`: CompareFaces and DetectFaces do not support
resource-level permissions, so there is nothing narrower to scope them to.
That is a limit of the service, and worth saying out loud to whoever grants
it, because a wildcard resource is exactly what a careful reviewer stops on.

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
