# API integration

The API (`apps/api`) is the product; both frontends are clients. Everything is
under `/api/v1`, documented at `/docs`, machine-readable at `/openapi.json`.

Two client rules, and only two:
1. `Authorization: Bearer <access token>` on everything. Identity comes from
   the token; no endpoint takes an employee identifier in the body.
2. `X-Install-Id` on `/mobile/punch` - handset binding is checked every punch.

## Web auth (preserved verbatim from apps/web)

Tokens live in **httpOnly cookies** (`bx_access`, `bx_refresh`) - never in
localStorage, never readable by page JavaScript. The pieces:

- `web/app/api/session/route.ts` — POST signs in (tokens → cookies), DELETE
  signs out (revokes upstream, drops cookies).
- `web/proxy.ts` — Next 16 middleware: every page except /login needs a
  session; refreshes an expiring access token; API-shaped 401s for fetch
  callers instead of HTML redirects.
- `web/app/api/gateway/[...path]/route.ts` — server-side pass-through that
  attaches the token for browser code. Forwards ONLY to the API base.
- `web/lib/session.ts` — server-component fetch. `ApiResult` reports WHY a
  call failed (`unauthorised | forbidden | unreachable | error`) - a 403 is
  never rendered as "server down".

Server components call the API directly with the cookie token
(`web/lib/api.ts`); client components go through `/api/gateway`.

- Env: `NEXT_PUBLIC_API` (default `http://127.0.0.1:8000`).

## Mobile auth

- Tokens in `expo-secure-store` (Keychain / EncryptedSharedPreferences).
- `src/session.ts` refreshes automatically per call; reopening the app never
  asks for a password unless the refresh token is dead or HR unbound the phone.
- Install id survives sign-out on purpose - it identifies the handset.
- **Mock mode is deleted**, not disabled. `src/config.ts` reads
  `EXPO_PUBLIC_API_BASE` from the environment (`.env`, see `.env.example`);
  fallback `http://127.0.0.1:8000` works only in the iOS simulator.

## Endpoint map → screens

| Endpoint | Web | Mobile |
|---|---|---|
| POST auth/login, refresh, logout | session route + proxy | session.ts |
| GET auth/me | shell identity | — (identity from login) |
| POST auth/set-password | — (web flow later) | Profile |
| GET mobile/me · POST mobile/punch | — | Home (punch) |
| GET mobile/month | `/` (employee), corrections flagged-days | Month |
| leave: types, balance, request, my-requests, cancel | `/leave` | Leave |
| corrections: submit, my-requests, cancel | `/corrections` (Yours) | Corrections |
| notifications: list, unread-count, read | bell + `/notifications` | Inbox + badge |
| admin/board | `/`, `/board`, `/people`, employee profile | — |
| admin/rejected | `/board`, profile | — |
| admin/month | `/month/[code]`, profile calendar | — |
| admin/correct | `/corrections` direct entry | — |
| admin/corrections pending + decide | `/corrections` queue | — |
| admin/leave pending + decide | `/leave` queue | — |
| admin/leave/balances | `/leave/balances`, profile | — |
| admin/leave accrue + carry-forward | `/leave/operations` | — |
| admin/leave policy + types + audit | `/leave/policy`, `/leave/audit` | — |
| admin/holidays GET/POST/DELETE | `/leave/policy` calendar | — |
| admin/enrolments (+photo, delete) | `/enrolment` | — |
| admin/devices GET + DELETE | `/devices` | — |
| admin/export/month.csv | board + dashboard download | — |

## Error normalization

- Web server-side: `ApiResult.reason` → `ErrorState` (403 copy per page).
- Web client-side mutations: show the API's own `detail` verbatim - it carries
  the numbers ("you have 3 days left"), which beats any generic message.
- Mobile: `SessionExpiredError` signs out; `PermanentPunchError` (422 on a
  stale queued punch) drops the punch from the queue WITH its reason shown.

## Offline queue (mobile, preserved)

`src/queue.ts` writes selfie + metadata to the document directory (not camera
cache); `src/sync.ts` drains on launch / foreground / after a successful
punch. `captured_at` travels with a queued punch and is bounded by the server
(absent→server time; future→server time noted; >48h→refused with reason).
Retry is idempotent (server dedupes per identity per second). Queued and
confirmed are visually distinct everywhere.

## Timezone

All attendance times render in Asia/Kolkata regardless of browser or server
zone (`web/lib/format.ts`, `mobile/src/format.ts`). Claimed correction times
are sent with an explicit `+05:30` offset - the wall clock the person means.
