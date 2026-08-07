# Myunivokai API Gateway

The gateway is the only public backend. It owns HTTP validation, request IDs,
CORS/security headers, Redis rate limiting/cache, JetStream publication, and
bounded Core NATS request-reply. It does not call AI or domain HTTP APIs.
DNA job, Universe, and Nature routes have separate handlers. Universe/Nature
subjects are fixed when each handler is constructed; shared RPC/cache mechanics
remain centralized in `RPCTransport`.

Generation flow:

1. `POST /api/{family}/worlds` validates the existing world-input contract.
2. The gateway publishes `myunivokai.commands.dna.generate.v1` and waits for
   JetStream `PubAck`.
3. It returns `202` with `jobId`, family, and `queued` status.
4. `GET /api/jobs/{jobId}` queries DNA Service through Core NATS.
5. World, variant, publish, and share routes query the owning family through
   versioned NATS subjects.

Redis is never a job queue or source of truth. Active jobs cache for one second;
terminal jobs, worlds, and privacy-safe share projections use configured bounded
TTLs. If Redis fails, cache becomes a miss and rate limiting falls back to a
conservative process-local bucket. Readiness reports the degradation.

## Admin route group (`/api/admin`)

A second, independently configured `chi` sub-router mounted alongside the
product group, gated by `ADMIN_ROUTES_ENABLED` (default `false`, so a bare
deploy of this binary never crash-loops the product edge over admin-only vars
nobody has filled in yet). It gets its own CORS handler (`ADMIN_ALLOWED_ORIGIN`,
exactly one origin, never a wildcard), its own Redis rate-limit bucket
(`internal/handlers/router.go`'s `adminRateLimitRouteKey`, distinct from the
product group's — sharing one key would let either group's limit silently
override the other's), and default-deny by construction: every route requires
either nothing (`/auth/login`, `/auth/invite/accept`), a presented refresh
cookie (`/auth/refresh`, `/auth/logout`), or a verified access token plus one
specific permission (every record and analytics route);
`internal/handlers/admin_router_test.go` enumerates the mounted routes and
fails if a future one is added without any of the three.

`internal/adminauth` + `internal/middleware.RequireAdminAccessToken` implement
local Ed25519 access-token verification plus the Redis `tokenVersion`
cache-miss fallback (`auth-service` is called at most once per miss, never
per request) — see
[notes/vision/auth-and-admin-plan.md#how-b-works](../../notes/vision/auth-and-admin-plan.md#how-b-works).
Session tokens travel only as `httpOnly`, `Secure` (in production),
`SameSite=Lax` cookies, never in a JSON body — see
`internal/handlers/admin_auth_handler.go`.

### Where each admin route reads from

| Routes | Backed by | Permission |
| --- | --- | --- |
| `/accounts*`, `/roles*`, `/permissions`, `/audit` | `auth-service` | `account:*`, `role:*`, `audit:read` |
| `/overview`, `/timeseries` | `analytics-service` | `chart:read` |
| `/worlds` | `analytics-service` | `world:read` |
| `/jobs` | `analytics-service` | `job:read` |

Every handler in this group is a **pure relay**: it decodes query parameters
into a contracts type, publishes one subject, and writes the payload back
verbatim. It sums nothing, groups nothing and merges nothing — every aggregate
the admin dashboard shows was computed in SQL inside `analytics-service`.

The rule that matters most here is what is *absent*: **no admin route may
publish a `universe`, `nature` or `dna` subject.** An admin page must wait on
exactly two processes — auth for the token, analytics for the data — never on
a domain service that Render's free tier may have spun down.
`admin_analytics_handler_test.go` asserts it by inspecting every subject the
broker saw, so a future refactor that "helpfully" fans a world list out to the
family services fails the build rather than shipping a 30-second admin page.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/gateway
```

Local default: <http://localhost:41800>. See the root Compose file for the full
NATS/Redis/domain stack and `contracts/openapi.yaml` for public routes.
