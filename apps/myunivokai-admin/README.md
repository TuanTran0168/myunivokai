# Myunivokai Admin

The internal staff console for Myunivokai — a separate Next.js app with its
own domain, sharing no code with `apps/myunivokai-web` (enforced by
`npm run check:boundary`) and no three.js. See
`notes/vision/auth-and-admin-plan.md#the-admin-app` and
`notes/sprints/sprint-04-2026-08-06/user-stories.md` (S4-AUTH-004).

## Session model

This app's browser never talks to the gateway directly. Every
`/api/admin/auth/*` route here is a BFF relay (`src/lib/auth-relay.ts`) that
calls the gateway's own `/api/admin/auth/*` server-to-server and re-emits its
Set-Cookie headers verbatim — since neither gateway cookie declares a
`Domain`, relaying them from this app's own response makes them first-party
to this app's origin instead of the gateway's. That is what lets
`src/middleware.ts` read the access cookie without a network hop, satisfying
"own domain" from the vision doc.

`middleware.ts` gates every route except `/login` on the access token's
local expiry check only (no signature verification — that stays the
gateway's job on every request that touches real data,
`RequireAdminAccessToken`). It deliberately does **not** attempt a silent
refresh: the refresh cookie is scoped to `Path=/api/admin/auth`, so the
browser never attaches it to a request for any other path, and middleware
handling `/` or `/worlds` structurally cannot see it. Reviving an expired
session instead happens client-side, where a fetch can target that exact
path:

- `src/app/login/page.tsx` tries a silent refresh on mount before showing the
  form, so a still-valid 14-day refresh token never forces a password
  re-entry.
- `src/hooks/use-session-keepalive.ts` refreshes every 5 minutes while the
  dashboard stays open, safely under the access token's 10-minute TTL.

RBAC navigation (`src/components/app-sidebar.tsx`) filters
`src/components/nav-config.ts` by the account's permission list, cached in a
non-httpOnly `myunivokai_admin_account` cookie (roles/permissions/email only,
never a token) since this phase ships no `/session` query endpoint — login
and refresh already return that data, so caching their response is enough.

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm run check:boundary
npm test
npm run build
```
