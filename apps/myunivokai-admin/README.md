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

RBAC navigation (`src/components/layout/app-sidebar.tsx`) filters
`src/components/layout/nav-config.ts` by the account's permission list, cached
in a non-httpOnly `myunivokai_admin_account` cookie (roles/permissions/email
only, never a token) since this phase ships no `/session` query endpoint —
login and refresh already return that data, so caching their response is
enough.

## Folder structure

Mirrors `apps/myunivokai-web`'s split: one folder per domain under
`src/features/`, not one folder per file *kind*. `src/features/accounts`,
`src/features/roles` and `src/features/audit` each own their page component,
dialogs and `api.ts`/`types.ts` — a route file under `src/app/(dashboard)/*`
is a one-line re-export of the feature's page component, same as
`apps/myunivokai-web/src/app/gallery/page.tsx` stays thin over
`src/features/gallery/*`. `src/components/layout/` holds cross-app chrome
(sidebar, nav config, page header, the content transition) that isn't any
one feature's; `src/components/ui/` stays the shared shadcn primitives;
`src/lib/` keeps only genuinely cross-cutting code (`admin-http.ts`'s fetch
wrapper, session/cookie handling, the gateway relay).

## Accounts, roles and audit (S4-AUTH-005)

`src/app/api/admin/[...path]/route.ts` is a generic BFF relay for every
`/api/admin/*` management call (accounts, roles, permissions, audit) —
unlike the auth routes, it sets no cookies of its own; it only forwards the
caller's already-first-party access cookie to the gateway and relays the
JSON response verbatim. This is what lets each feature's `api.ts` (built on
`src/lib/admin-http.ts`'s shared `adminRequest` + `AdminApiError`) call
`/api/admin/accounts`, `/api/admin/roles`, etc. as same-origin fetches from
the browser without a dedicated Route Handler file per endpoint.

Screens: `accounts` (list, invite, disable/enable), `accounts/[accountId]`
(assign/revoke roles), `roles` (create/edit/delete, permission checkboxes),
`audit` (cursor-paginated event log). The invite dialog surfaces the raw
invite token once — no email infrastructure exists yet, so a staff member
relays it out of band.

The Roles screen shows two system-level entries, but only one is a database
row: `basic_user` is the real seeded system role (`permission_sync.go`
reseeds it at every auth-service startup). "Super Admin" is a pinned,
read-only card (`src/features/roles/SuperAdminCard.tsx`) built from
`accounts.is_super_admin` — deliberately NOT a second role row. See
`notes/vision/auth-and-admin-plan.md#rbac`: a real role row can be edited or
deleted like any other, which is exactly the "system becomes
unadministerable" risk the bypass flag exists to prevent, so the UI
represents it without reversing that design.

## Design

Dark liquid glass (`src/app/globals.css`), v3 of this app's theme. v1 washed
brass across a warm-cream light background and was rejected as a copy of
Claude.ai's palette; v2 swung to a neutral light dashboard (Linear/Vercel/
Stripe) to fix that, but a real reference review found the opposite problem —
a translucent panel over a flat white background has nothing colorful behind
it for the blur to reveal, so the glass itself read as invisible. This pass
is grounded directly in `apps/myunivokai-web`'s own design system ("The
Vitrine + Liquid Glass", that app's `globals.css`) rather than inventing a
third palette: the same void (`#08080A`), paper foreground (`#F2EEE6`) and
brass accent (`rgb(201 163 91)`, the middle stop of the shared `BrandMark`
gradient) as the product app, so both apps read as one brand instead of two
similar-but-different metallic yellows.

`body` paints a static backdrop for the glass to work against — one soft
brass glow (echoing the logo's disc) plus a faint scattered starfield, both
fixed and non-animated (the v1 roaming blob field was itself called out as
"too much animation"). Every floating surface — the sticky header, the
sidebar, and now ordinary `Card` content too — shares one `.glass-panel`
material: blur+saturate over that backdrop, a diagonal specular highlight
top-left, a faint brass inner ring, and a soft dark lift shadow. Applying it
to Card as well as the nav chrome is a deliberate departure from Apple's own
WWDC25 rule that glass is nav-layer-only — this app's reference asked for
every widget to be glass, not just the bars, so `card.tsx` carries the class
directly rather than staying a flat surface. `prefers-contrast: more` still
drops every glass surface back to a flat, bordered background, since blur
reduces text contrast against whatever scrolls underneath.
`src/components/layout/brand-mark.tsx` reuses
`apps/myunivokai-web/public/logo.svg`'s exact mark rather than inventing a
second symbol for this app.

`motion` supplies animation, scoped narrowly on purpose: the first pass wrapped
the entire page (sidebar included) in one `AnimatePresence`, so every nav
click re-animated the chrome along with the content. `src/components/layout/content-transition.tsx`
now wraps only the content pane inside `(dashboard)/layout.tsx`'s `<main>` —
a fast, opacity-only crossfade, no y-translate. The sidebar's active-nav pill
(`layoutId="nav-active-pill"`) and the login page's own entrance/shake stay
as they were; both are already scoped to just the element that should move.

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm run check:boundary
npm test
npm run build
```
