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
either nothing (`/auth/login`) or a presented refresh cookie
(`/auth/refresh`, `/auth/logout`); `internal/handlers/admin_router_test.go`
enumerates the mounted routes and fails if a future one is added without
either.

`internal/adminauth` + `internal/middleware.RequireAdminAccessToken` implement
local Ed25519 access-token verification plus the Redis `tokenVersion`
cache-miss fallback (`auth-service` is called at most once per miss, never
per request) — see
[notes/vision/auth-and-admin-plan.md#how-b-works](../../notes/vision/auth-and-admin-plan.md#how-b-works).
No route mounts it yet: the first permission-gated admin route is
S4-ANALYTICS-005, which this primitive is built and unit-tested ahead of, not
a route this phase invents on its own. Session tokens travel only as
`httpOnly`, `Secure` (in production), `SameSite=Lax` cookies, never in a JSON
body — see `internal/handlers/admin_auth_handler.go`.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/gateway
```

Local default: <http://localhost:41800>. See the root Compose file for the full
NATS/Redis/domain stack and `contracts/openapi.yaml` for public routes.
