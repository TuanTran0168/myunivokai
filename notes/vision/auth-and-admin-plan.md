# Auth service and internal admin app — plan

> **Document status:** Proposed plan; no source exists yet
> **Last source review:** 2026-08-05

Two new deliverables, deliberately kept apart from the 3D product:

1. **`services/auth-service`** — identity for staff now, built so end-user login
   on the 3D web later is a configuration and policy step, not a rewrite.
2. **`apps/myunivokai-admin`** — an internal app for browsing and managing
   records, plus charts. Admin accounts only. No 3D, no public pages.

Nothing in the 3D web changes. The public gateway gains no admin route.

## Scope

**In scope now**

- Staff login, logout, refresh, password change, account disable.
- RBAC: roles, permissions, server-side enforcement, audit trail.
- Record browsing: worlds, variants, DNA jobs, profiles, share slugs.
- A small set of operational mutations, each audited.
- Charts on business and job-health data.

**Explicitly not now**

- End-user login on the 3D web — see the next section.
- World ownership, anonymous claim/migration, deletion/export.
- Infrastructure metrics dashboards. Consumer lag and ack latency belong to
  Sprint 2's ops tooling, not to a product admin app. Overlapping the two makes
  the admin app a second, worse Grafana.
- Single sign-on, social login, organisations, billing.

## Why this does not violate DEFERRED-AUTH-001

[`DEFERRED-AUTH-001`](../user-stories/engineering-backlog.md#deferred-auth-001--define-identity-before-authentication)
defers authentication until issuer, account mapping, **object ownership**,
anonymous claim/migration, public share, and deletion/export are approved. That
deferral is about *visitors owning worlds*. Every one of its open questions is a
question about ownership.

Staff identity does not touch ownership. An admin never owns a world; the admin
reads and administers records that already exist and already have no owner. So
staff auth can ship while the visitor-identity questions stay open — provided
the token design does not quietly pre-decide them. Two rules keep that promise:

- **No `owner_account_id` column anywhere** until DEFERRED-AUTH-001 is approved.
  The moment a world points at an account, ownership has been decided by
  accident.
- **Audience-scoped tokens from day one.** A staff token carries
  `audience: "admin"`; a future visitor token carries `audience: "web"`. Each
  edge accepts exactly one audience. Without this, the first end-user token ever
  issued is also a valid admin token.

`accounts.kind` is `staff` from the start, with `end_user` reserved. That is a
column value, not a decision about what an end user may own.

## The hard problem: three services own the data

This is the part to get right before writing any code. Today:

- `myunivokai_dna`, `myunivokai_universe`, `myunivokai_nature` are separate
  databases with **no cross-database foreign keys**, and nothing may read
  another service's tables ([be/source-overview.md](../be/source-overview.md)).
- The only read path is Core NATS request-reply through the gateway, and every
  existing query is **by id**. There is no list, no search, no aggregate.

An admin app is the opposite shape: list everything, filter, sort across
families, count per day. Three ways to get there.

| Option | How | Verdict |
| --- | --- | --- |
| **A. Admin query subjects** | Each domain service gains list/search/aggregate subjects over its own database; the admin edge fans out and merges | **Start here** |
| **B. Read-model service** | A new `admin-service` consumes existing outbox events into its own denormalised database | Later, on a trigger |
| **C. Direct database access** | Admin app reads all three databases | **Rejected** |

**Why A first.** At current volume `SELECT date_trunc('day', created_at), count(*)`
on each family database is milliseconds, and A adds no new database, no
eventual consistency, and no backfill of existing rows. It also keeps every
table behind the service that owns it, which is the rule the whole backend was
built around.

**Why B is not premature.** The pieces already exist — outbox, inbox,
JetStream — so B is a read model, not new architecture. Adopt it when one of
these becomes true, and not before:

- a screen needs a join across two family databases that the edge cannot merge;
- aggregate queries reach a measured p95 the owner is unwilling to pay on the
  production database;
- a chart needs history the source tables do not retain.

Building B first costs a backfill path, a second source of truth for every
record, and "why does admin show 41 and the database show 42" for the rest of
the project's life.

**Why C is rejected.** Not because of purity. A schema change in
`universe-service` would silently break admin, and the failure surfaces as a
wrong number on a chart rather than a failing test in the service that changed.
It also hands one credential read access to every visitor's personal text.

**Cross-family pagination.** Two databases cannot share an offset. The contract
is a **cursor per family** — `{universe: cursor, nature: cursor}` — merged by
`createdAt` in the edge. Say this in the contract now; retrofitting it after a
UI is built against page numbers is a rewrite of both ends.

## Target topology

```text
admin browser
  -> apps/myunivokai-admin        (Next.js, own domain, httpOnly cookies)
       -> services/admin-gateway  (the only public admin edge)
            -> auth.*.v1                    Core NATS  -> auth-service -> myunivokai_auth
            -> universe.admin.*.v1          Core NATS  -> universe-service
            -> nature.admin.*.v1            Core NATS  -> nature-service
            -> dna.admin.*.v1               Core NATS  -> dna-service

myunivokai-web (3D)  ->  api-gateway   ... unchanged, no admin route, no auth
```

**Why a separate `admin-gateway` and not routes on the existing gateway.** They
have opposite threat models. The admin edge wants an IP allowlist, strict rate
limits, no CORS to any public origin, no cache, and the freedom to be taken
offline during an incident without touching the product. Bolting it onto the
public gateway means one misconfigured CORS entry or one route-matching mistake
exposes admin surface to the internet, and every admin deploy risks the product
edge. The cost is one more small Go service that reuses `internal/broker` and
`internal/middleware` almost unchanged.

## auth-service

A NATS worker like the family services — no HTTP listener, no published port.
Owns `myunivokai_auth`.

### Tokens

**Short-lived access JWT plus rotating opaque refresh token.**

| | Choice | Reason |
| --- | --- | --- |
| Access token | JWT, Ed25519 (`EdDSA`), 10 minute expiry | Every edge verifies locally with a public key. No network hop per request, and login still works when `auth-service` is cold — Render's free plan makes cold starts routine |
| Access claims | `subject`, `roles`, `audience`, `tokenVersion`, `expiresAt` | Roles, not permissions: a permission list grows and a stale token must not carry it |
| Refresh token | 32 random bytes, stored hashed, single use, rotated on every refresh, 14 day expiry | Rotation makes theft detectable — a reused token invalidates the whole family |
| Transport | `httpOnly`, `Secure`, `SameSite=Lax` cookies; refresh cookie scoped to the refresh path | An admin panel with a token in `localStorage` turns any XSS into full takeover |

**Revocation.** Disabling an account or changing a password bumps
`accounts.tokenVersion`. Refresh checks it; access tokens do not. The window is
therefore **up to 10 minutes**, stated here so nobody discovers it during an
incident. Anything shorter needs a per-request check against auth-service and
gives up the cold-start property above.

**Key handling.** Private key in the environment, never in git. Publish the
public key by value to the edges. Support two active public keys so rotation
does not log everyone out.

### Passwords

- **Argon2id** (`golang.org/x/crypto/argon2`, `argon2.IDKey`), 16-byte salt,
  32-byte key, parameters stored per row so they can be raised later.
- Free-plan instances have 512 MB of RAM. Do **not** start at 64 MiB per hash —
  a handful of concurrent logins will exhaust the instance. Start at the OWASP
  minimum (about 19 MiB, 2 iterations, 1 lane), cap concurrent verifications,
  and raise the cost only after measuring on the real instance size.
- No self-signup, ever. The first account comes from a bootstrap command that
  requires an operator-supplied password and forces a change on first login.
  **No default password in the repository**, not even a local-only one.
- Fixed per-account and per-IP attempt limits with lockout, and a constant-time
  response whether or not the account exists.

### Schema

`accounts`, `roles`, `permissions`, `role_permissions`, `account_roles`,
`refresh_tokens`, `audit_events`.

`audit_events` lives here because auth-service is the one service that knows who
the actor is. Every admin mutation and every login, failed login, role change
and reveal of personal data writes one row: actor, action, target, time, source
address, result. Written on the request path, not from a log tail.

## RBAC

Permissions are strings on the resource, verbs explicit:

```txt
world:read        world:unpublish     variant:read
job:read          job:retry
profile:read      profile:reveal      chart:read
account:read      account:manage      audit:read
```

| Role | Has |
| --- | --- |
| `owner` | Everything, including `account:manage` and `audit:read` |
| `admin` | Everything except `account:manage` |
| `support` | `*:read`, `job:retry`, `world:unpublish` — no `profile:reveal` |
| `analyst` | `chart:read` and aggregate reads only; no individual records |

Rules that decide whether this is real authorization or decoration:

- **Enforced at the admin edge, per route, default deny.** An unknown route and
  a route with no declared permission both refuse.
- The UI receives the caller's permission list **only to hide controls**. Hiding
  a button is not authorization; the edge check is.
- Roles resolve to permissions at the edge from a cached role map, so revoking a
  permission takes effect at the next request rather than the next token.
- `profile:reveal` is separate on purpose. See Risks.

## The admin app

`apps/myunivokai-admin` — its own Vercel project, its own domain, its own
`.env.example`.

| Choice | Version | Reason |
| --- | --- | --- |
| Next.js | 15, App Router | Server components keep the access token server-side; middleware is the natural default-deny gate. It also makes this app the **proving ground for the Next.js major upgrade** the 3D web already owes ([engineering-backlog.md](../user-stories/engineering-backlog.md), Next.js 14 advisories) — the upgrade gets exercised somewhere no visitor can see it |
| React | 19 | Comes with Next 15 |
| TypeScript | strict, as in the 3D web | Same rules: no abbreviated names, no hardcoded magic values |
| Tailwind CSS | v4 | Already the styling language in this repo |
| shadcn/ui | current | Owned components, no runtime dependency on a component vendor |
| TanStack Query | v5 | Server state, retries, invalidation after mutations |
| TanStack Table | v8 | Sorting, filtering and cursor pagination on record lists |
| Recharts | current | Enough for these charts; swap to visx only if a chart needs custom rendering |

**Why not a Vite SPA.** Cookie-based auth wants a server, and an SPA would push
the access token into client JavaScript — the exact thing the cookie design
avoids.

Non-negotiable in this app:

- Every route requires a session. Middleware denies by default; the login page
  is the single exception.
- `noindex`, no sitemap, no share pages, no static generation of record data.
- **Zero imports from `apps/myunivokai-web`**, and no three.js. The only shared
  code is `contracts/`. Add a CI check for this — separation that is not tested
  is separation until the first deadline.

## Charts

From data the services already store, through the aggregate subjects of option A:

| Chart | Source |
| --- | --- |
| Worlds created per day, split by family | `worlds.createdAt` in each family database |
| Job outcomes over time — completed, failed, in flight | root jobs in `myunivokai_dna` |
| Time from accepted to completed, median and p95 | root job timestamps |
| AI provider mix, attempts per job, failure rate | provider attempts in `myunivokai_dna` |
| Variants per world, and how often a non-default variant is selected | variants per family |
| Publish rate — worlds that got a share slug | share slugs per family |

Every chart states its time zone and its bucket, and reads its range from the
query rather than a constant in the component.

## Extending to 3D-web login later

When DEFERRED-AUTH-001 is approved, the additional work is:

1. `accounts.kind = end_user`, self-signup, email verification, password reset.
2. `audience: "web"` tokens and a disjoint role set; the admin edge keeps
   rejecting them because it only accepts `audience: "admin"`.
3. Auth verification middleware on the **public** gateway — new code there, but
   the same public key and the same claim shape.
4. The ownership decisions: `owner_account_id`, anonymous claim/migration,
   deletion and export.

Steps 1–3 are additive. Step 4 is the product decision that was deferred, and
building auth now does not make it any easier to skip.

## Phases

One branch each, per [git-convention.md](../coding/git-convention.md).

| Phase | Branch | Delivers |
| --- | --- | --- |
| 0 | `feat/repo/auth-admin-contracts` | Subjects, JSON schemas, `contracts/openapi-admin.yaml` (separate file so the public spec never advertises admin routes), this plan approved |
| 1 | `feat/be/auth-service` | auth-service, `myunivokai_auth`, login/refresh/logout, Argon2id, bootstrap admin, audit events, tests |
| 2 | `feat/be/admin-gateway` | Admin edge, token verification, default-deny route policy, rate limits, CORS for one origin |
| 3 | `feat/fe/admin-app-shell` | Next.js 15 app, login, session, RBAC-aware navigation, one record list end to end |
| 4 | `feat/be/admin-query-subjects` | List/search/aggregate subjects in dna, universe and nature; cursor-per-family pagination |
| 5 | `feat/fe/admin-records` | Record lists and detail views, first audited mutations |
| 6 | `feat/fe/admin-charts` | The chart set above |
| 7 | `feat/be/auth-hardening` | TOTP two-factor, invite flow, account management UI, lockout tuning, key rotation drill |
| 8 | `feat/repo/admin-deployment` | `render.yaml` entries, Vercel project, secrets, runbook |

Phases 1–3 are the smallest set that produces a usable panel: log in, see
records, nothing else. Ship that before phase 4 widens the query surface.

## Risks

**The admin panel becomes the highest-value target in the system.** It can read
every visitor's raw self-description — the most personal text the platform
holds. Mitigations, all of them in the design above rather than bolted on:
`profile:reveal` as its own permission, raw input masked by default, an audit
row per reveal, and no bulk export of personal text in phase 1.

**Cold starts.** Render's free plan sleeps. Stateless access-token verification
means a sleeping auth-service does not block navigation, only login and refresh.
Accept it internally, or pay for a warm instance before staff rely on it.

**Scope creep into content management.** "While we are here, let us edit worlds
from the admin panel" turns a read-mostly tool into a second write path into
deterministic data. Any mutation must go through the owning service's existing
rules, and any mutation that would break determinism does not get built.

**A second auth implementation.** If the 3D web later grows its own session
handling instead of using this issuer, there are two systems and one of them is
wrong. The audience claim exists so there never needs to be a second issuer.

## Decisions the owner should confirm before phase 1

1. **Admin domain and IP allowlist** — a separate domain is assumed. Is an IP
   allowlist acceptable for staff, or will people log in from anywhere?
2. **Revocation window** — is up to 10 minutes acceptable in exchange for no
   auth round trip per request?
3. **Two-factor timing** — phase 7 as planned, or required from the first
   account because this panel reads personal data?
4. **Warm instance** — pay for one for auth-service, or accept cold-start login
   latency internally?
