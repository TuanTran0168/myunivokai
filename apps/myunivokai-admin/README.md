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

## Cold starts

The services behind this console sleep. Staff open the panel a few times a day,
not continuously, so `auth-service` and `analytics-service` are idle far more
often than the product services are — and the first thing that breaks is login
itself, where a transport failure used to surface as "Invalid email or
password". That message was not merely unhelpful; it was untrue.

`src/lib/wake-retry.ts` waits out `503 SERVICE_WAKING` while the gateway starts
the service, reading `Retry-After` for the delay. Both BFF relays forward that
header (`src/lib/relay-headers.ts`) — they rebuild the gateway's response
rather than streaming it, so any header the browser needs has to be named
explicitly.

The retry lives in the browser, not in the route handlers: a server-side wait
would hold a Next.js handler open for a whole cold start, which is exactly what
the gateway refuses to do, and route handlers have their own execution limits.
It applies to every method, since `SERVICE_WAKING` means the request provably
never reached a service.

The login form says "Starting the service…" while this happens
(`useLogin` returns `isWakingService` alongside the mutation), because a minute
of silent spinner on the one screen with no other content reads as a hang. The
silent refresh waits too — giving up there would show the credential form to
somebody whose session is still valid, and with no refresh cookie the gateway
answers 401 without consulting auth-service at all, so a logged-out visitor
waits for nothing.

## Folder structure

Mirrors `apps/myunivokai-web`'s split: one folder per domain under
`src/features/`, not one folder per file *kind*. `src/features/accounts`,
`src/features/roles`, `src/features/audit` and `src/features/analytics` each
own their page component,
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

## Dashboard, worlds and jobs (S4-ANALYTICS-007)

`src/features/analytics/` owns the three screens that read business data:
the dashboard (`/`), the worlds table (`/worlds`) and the jobs table
(`/jobs`). All three go through the same generic BFF relay as the management
screens, hitting `/api/admin/{overview,timeseries,worlds,jobs}`.

Every number on these screens was computed in SQL by `analytics-service`.
Nothing here sums, groups or sorts a result set — if a figure is missing, it
belongs in that service's query, not in a `.map()` here. The data is
**eventually consistent**: a world appears seconds after it is created, which
the dashboard says out loud rather than leaving a reader to wonder why a
just-created world is absent.

### Pagination

`src/components/ui/cursor-pagination.tsx` drives both tables. The server pages
by keyset, not `OFFSET`, so it can hand back a cursor for the *next* page and
nothing that would let a client jump to page 7 — page numbers do not exist by
construction. Going back is therefore the client's job: the hook keeps the
cursors it has already used on a stack and pops one to return. That is the
trade for a list that costs the same at page 1000 as at page 1.

Changing a filter or the page size resets that stack, because both redefine
what row 1 is; resuming from a stale cursor would silently skip or repeat
rows. Page size offers 25/50/100, matching `contracts.AnalyticsMaximumPageSize`
— the server clamps to the same bound, so a mismatch degrades the picker
rather than breaking a query.

### No charting library

The distributions are flex rows with a percentage width; the daily activity
chart is hand-written SVG (`ActivityChart.tsx`). Neither has axes, zoom, or a
tooltip that follows the cursor, and a charting library would have been the
app's first — and its import statement alone is larger than both components.
Reach for a real one when a screen genuinely needs axes or brushing.

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
