# Web architecture (frontend-main/web)

Next.js 16 (App Router) + React 19 + Tailwind 4 + TypeScript - the same stack
and pins as apps/web, so nothing about the toolchain is new. framer-motion and
lucide-react are the only notable runtime deps; animation is mostly CSS.

## Structure

    app/
      (auth)/login/         approved sign-in page - copied verbatim, do not redesign
      (dashboard)/          every signed-in screen, one shared shell
        page.tsx            role-adaptive overview
        board/  corrections/  devices/  enrolment/  notifications/
        leave/ (+ policy, balances, operations, audit)
        month/[code]/  people/ (+ [code])
        loading.tsx         route-level skeleton
      api/session/          login/logout cookie handling (preserved)
      api/gateway/[...path] token-attaching pass-through (preserved)
      layout.tsx            document + fonts via <link> + theme-init script
      globals.css           the design system (see DESIGN_SYSTEM.md)
    components/             screen components; ui/ holds the sign-in kit
    lib/
      session.ts            cookies + apiFetch (server only)
      api.ts                all server-side data access, grouped by domain
      format.ts             types + pure formatting (client-safe)
      capabilities.ts       role → capability model
    proxy.ts                middleware: auth redirect + token refresh

## Rules that keep it maintainable

- **Pages are server components.** They fetch via `lib/api.ts` and hand plain
  data to client components. Client components never import `lib/api.ts` or
  `lib/session.ts` (cookies) - they import `lib/format.ts` and fetch through
  `/api/gateway`.
- **Mutations live in client components**, POST through the gateway, then
  `router.refresh()` so the server-rendered truth re-renders. No client cache
  to drift.
- **Role checks go through `capabilitiesFor(role)`** - one file, mirroring the
  backend RANK. Pages still prefer *asking the API* (e.g. `/leave` shows the
  approver queue iff `admin/leave/pending` succeeds).
- **Only serialisable props cross the server→client boundary** - e.g.
  `MetricTile` takes an icon *name*, not a component.
- **Every failed fetch keeps its reason.** `ErrorState` renders forbidden /
  unreachable / error distinctly, with per-page "who this is for" copy.

## State management

None beyond React. The data is server truth recomputed per request; the
handful of client states (drawer, dialogs, filters, form fields) are local
useState. Adding a store or query cache would add staleness, not speed, at
this scale.

## Commands

    npm install
    npm run dev        # http://localhost:3000
    npx tsc --noEmit
    npm run build

Env: `NEXT_PUBLIC_API` (default http://127.0.0.1:8000).
