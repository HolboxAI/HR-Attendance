# Domain types

The canonical shapes live with each client, typed against the API's own
response models:

- Web: `frontend-main/web/lib/format.ts` (safe for client components; the
  session machinery is separate in `lib/session.ts`).
- Mobile: `frontend-main/mobile/src/types.ts`.

They are deliberately NOT a shared package. Two consumers do not justify a
build step, and the web and mobile apps genuinely want different views of the
same endpoints (web keeps snake_case API fields; mobile adapts to camelCase at
its API layer). If a third consumer appears, generate a client from
`/openapi.json` instead - the API is machine-readable by design.
