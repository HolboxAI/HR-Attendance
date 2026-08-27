# Boxcode presence & punch verification — implementation spec

Self-contained handoff. Everything needed to rebuild the punch-verification
logic, with the exact constants and rules in production here. No code
required from this repo.

---

## 1. The pipeline, in order

One punch = one HTTP request carrying: a selfie (multipart), `lat`, `lng`,
`accuracy_m`, optional `fix_age_seconds`, `is_mocked` flag, optional
`wifi_bssid`, optional `captured_at` (offline queue only), plus an
`X-Install-Id` header and a bearer token.

Checks run **cheapest first, stop at first failure** — never pay for a face
comparison on a punch that already failed:

```
1. Auth          token valid? → identity comes ONLY from the token.
                 There is NO employee field in the request. Ever.
2. Device        X-Install-Id must be the handset bound to this employee.
3. Presence      GPS / WiFi policy (section 2-3).
4. Face          selfie vs enrolled reference photo (section 5).
5. Persist       ALWAYS — accepted AND refused punches are stored,
                 refusals with their reason. Nothing is silently dropped.
6. Resolve       recompute the derived attendance day from all punches.
```

Server clock stamps the punch. The client's clock is never trusted (one
bounded exception: section 7).

---

## 2. GPS logic — exact

**Distance**: haversine, earth radius 6,371,000 m.

```
a  = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
d  = 2 · R · asin(√a)
```

**Constants**:

| Constant | Value | Why |
|---|---|---|
| Geofence radius | 200 m (per-location, DB-stored) | generous on purpose — see below |
| MAX_ACCEPTABLE_ACCURACY_M | 100 m | a fix vaguer than this proves nothing |
| MAX_FIX_AGE_SECONDS | 120 s | a cached fix from the bus ride is not "here" |

**Decision order** (after WiFi short-circuit, section 3):

1. `lat`/`lng` missing → refuse: "Location permission denied or unavailable"
2. `is_mocked` true (Android reports mock providers) → refuse: "Mock location
   detected". **Do NOT compute distance for a mocked fix** — a number derived
   from admitted-fake coordinates looks like evidence and is not. Store
   distance as null.
3. `accuracy_m > 100` → refuse: "GPS accuracy too poor (Nm)"
4. `fix_age_seconds > 120` → refuse: "Stale location fix (Ns old)"
5. Compute `distance = haversine(punch, office)`
6. **The subtle rule — subtract the phone's own error margin:**

   ```
   effective = distance − accuracy_m
   refuse if effective > radius
   ```

   A phone at a desk with a weak indoor fix might report 230 m ± 60 m.
   Raw-distance comparison marks that person absent for a day they worked —
   the worst failure an attendance system has. Give the reading its own
   stated benefit of the doubt.
7. Refusal message must carry the number: "You're about 451m from the office
   — check in from inside". Never a bare "failed".

**Philosophy**: the radius stays generous (200 m) because GPS is 10–30 m
outdoors, worse indoors, and a false reject is worse than a rare false
accept. Do not "fix" cheating by shrinking the radius — that trades a
possible cheat for guaranteed false absences. WiFi is the strong signal.

**Known limit**: GPS is effectively 2-D. Vertical accuracy is tens of metres,
so floor 0 and floor 3 of the same building are identical to GPS. No radius
fixes this (the problem is vertical, the radius horizontal). Only BSSID does.

---

## 3. WiFi / BSSID logic

Match on **BSSID** (the access point's MAC, e.g. `a4:2b:8c:11:03:f7`) —
never on SSID: a network *name* can be spoofed by naming a hotspot after the
office.

**Normalization** (apply on write AND on compare): trim, lowercase,
`-` → `:`. Store canonically; validate as six hex pairs.

**Per-location config, stored in the database, changeable at runtime** — a
list of allowed BSSIDs (a floor usually has several APs; phones roam) and a
policy:

| Policy | Rule |
|---|---|
| `gps_only` | radius alone; BSSID ignored |
| `wifi_or_gps` (default) | on an allowed BSSID → **presence proven, GPS checks skipped entirely** (still record distance if coords present, for the log). Otherwise fall through to GPS |
| `wifi_required` | not on an allowed BSSID → refuse "Connect to the office WiFi to check in", no GPS fallback |

The WiFi short-circuit is the point: being associated to the office AP is
proof on its own, and running GPS checks anyway would only add indoor false
rejects. This is also what closes the floor problem — an AP's radio range is
per-floor in a way coordinates never are.

**Guard**: refuse (HTTP 409, not a warning) any attempt to set
`wifi_required` with an empty BSSID list — that combination refuses every
punch in the company and presents as "the app is broken".

---

## 4. Device binding

One active handset per employee. `install_id` = random ID generated at app
install (not a hardware serial).

- **Bind at login** (login request carries `install_id`). Same phone again =
  no-op. Reinstall = new id = new phone (conservative; HR resolves).
- **Check on every punch**: id absent → "This phone is not registered. Sign
  in again to register it." · id bound to someone else → "This phone is
  registered to another employee" (never say whose) · employee already bound
  elsewhere → "Your account is already set up on a different phone. Ask HR
  to remove the old one."
- **HR unbind** (admin endpoint): deactivates the binding row (never deletes
  — history survives) and revokes that handset's refresh sessions so a lost
  phone cannot refresh its way back in.

What this defeats: shared/stolen passwords, two people punching from their
own phones on one login.

---

## 5. Face verification

1:1 comparison (AWS Rekognition CompareFaces) against ONE enrolled reference
photo per employee — never 1:N search, no stored embeddings, no biometrics
in the DB (only a storage key for the photo file).

**Quality gate first** (DetectFaces), refuse with a human reason:
- no face → "No face detected — move into better light"
- \>1 face → "More than one face in frame"
- face confidence < 95 → "Face unclear — try again"
- sharpness < 20 → "Photo too blurry"
- |yaw|, |pitch| or |roll| > 35° → "Look straight at the camera"

**Then CompareFaces**, threshold **90.0 similarity** — and enforce the
threshold on your side too, don't trust the API's own filter.

**Three outcomes, never conflated** (this distinction was a real bug here):
- **Match / no-match** → face_ok true/false. No-match refuses the punch.
- **Client image error** (unreadable/oversized image, provider's "no face")
  → a REFUSAL with a reason. The submission was bad.
- **Provider outage** (throttle, network, auth) → NOT a refusal. Keep the
  punch, record face_ok = NULL ("check not performed"), stash the error.
  Recording an outage as a failed check permanently accuses someone of
  failing a check that never ran; refusing the punch loses attendance for
  an AWS blip.

**No enrolled photo** → face_ok = NULL, punch accepted (strict mode flag
flips this to refusal with "ask HR to enrol your face"). NEVER record
face_ok = true against a missing reference — that manufactures evidence.

**Accepted limit, on purpose**: CompareFaces answers "same face", never
"live person". A photo of the right person held to the camera passes, by
design (no liveness in v1). Binding + geofence narrow the remaining hole to
a colleague inside the office holding the victim's own unlocked phone with
their photo — accepted at small scale, and every selfie is stored so it's
visible after the fact.

---

## 6. Persistence invariants

- `punch_events` is **append-only**. Never UPDATE or DELETE. Corrections are
  new rows approved by a second human.
- Refused punches are stored with reason + evidence (distance, similarity,
  photo key). "The app wouldn't let me check in" must be answerable.
- The daily attendance record is **derived** — delete-and-recompute from
  punches must reproduce it exactly. Never hand-edit it.
- Store the selfie BEFORE verification, so even a refused attempt has its
  evidence attached — and a crash mid-check can't orphan a photo silently.
- Dual clock on every punch: `event_ts` (when it happened) vs `received_ts`
  (when the server got it).

---

## 7. Offline queue (the one client-time exception)

Phones queue punches offline and sync later. `captured_at` is the single
client-supplied timestamp accepted, **bounded, not trusted**:

- absent → server time (the normal case)
- in the future (>120 s skew) → phone clock wrong; use server time, note it
- older than 48 h → refuse with that reason (no backfilling a month from a
  drawer)
- otherwise → use it as event time; shift date follows event time, not sync
  time (a 23:50 punch syncing at 00:10 belongs to yesterday)

Idempotency: dedupe per identity per second — a retried/double-tapped punch
is one row. A permanently refused queued punch is dropped from the client
queue WITH its reason shown, never silently.

---

## 8. Message rules

Every refusal states the actionable fact: the distance, the specific quality
problem, the binding state. "Failed" is banned. Statuses in UI always carry
a word + glyph, never colour alone.
