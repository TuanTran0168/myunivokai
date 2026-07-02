# API gateway — detailed design (Phase 3)

Part of the [vision folder](README.md).

## What the gateway owns (and services stop owning)

| Concern | Today (in universe-service) | With gateway |
| --- | --- | --- |
| Public origin & routing | n/a (one service) | single URL, path-based routing table |
| CORS | `go-chi/cors` in router | gateway only; services drop it |
| Rate limiting | per-IP token bucket + TRUST_PROXY | gateway only (one bucket per client across ALL services) |
| Request ID | issued in middleware | issued at gateway, propagated via `X-Request-Id` |
| Auth (future auth-service) | none | verify JWT once, forward identity as trusted headers |
| Retries/timeouts/circuit breaking | ad-hoc per client | uniform per-route policy |
| Response caching | none | share endpoints (`/share/*`) get short public cache |

## Options compared

| Option | Effort | Fit |
| --- | --- | --- |
| A. World-service stays the facade | zero | Right answer until auth-service exists — Phase 2 default. |
| B. Hand-rolled Go gateway (chi + `httputil.ReverseProxy`) | ~200 focused lines | **Recommended for Phase 3.** Same language/idioms as everything else; the existing RequestID/RateLimit/CORS middleware moves there almost verbatim; full control over the error taxonomy. |
| C. Traefik / Caddy / Nginx as a Render service | config, not code | Viable, but a second tech to operate, and Render has no managed gateway to lean on. |
| D. Kong / KrakenD / Envoy | heavy | Overkill at this scale; revisit only with 10+ services or a platform team. |

## Design of the Go gateway (option B)

```txt
services/api-gateway/
  cmd/gateway/main.go
  internal/routing/table.go       # path prefix -> upstream, per-route policy
  internal/middleware/            # RequestID, Logging, RateLimit, CORS (moved)
  internal/proxy/reverse_proxy.go # httputil.ReverseProxy + error mapping
```

Routing table — config, not code (env or a small YAML):

```txt
/api/v1/worlds*       -> WORLD_SERVICE_URL      timeout 120s (create waits on AI)
/api/v1/share/*       -> WORLD_SERVICE_URL      timeout 5s, cache 60s public
/api/v1/auth/*        -> AUTH_SERVICE_URL       timeout 5s
/api/v1/healthz       -> gateway itself (liveness)
/api/v1/statusz       -> fan-out readyz of all upstreams (aggregate health)
/                     -> landing page (moves from universe-service)
```

Middleware order (identical semantics to today's router, one level up):

```txt
RequestID -> Logging -> RateLimit(TRUST_PROXY-aware) -> CORS -> per-route timeout -> ReverseProxy
```

Rules that keep it honest:

- Gateway **appends** itself to `X-Forwarded-For` and forwards the client IP;
  scene/world services set `TRUST_PROXY=true` and trust exactly one hop more.
- Upstream transport failure → 502 `UPSTREAM_UNREACHABLE`; upstream timeout →
  504 `UPSTREAM_TIMEOUT`; both logged with `request_id` — same envelope shape
  as `httpx.WriteError`, so the FE error path needs no change.
- Circuit breaker per upstream (simple: trip after N consecutive transport
  failures, half-open probe after cooldown) so one dead scene service cannot
  hold connection slots for everything else.
- The gateway does NOT parse business payloads — it never becomes the place
  where domain logic hides.

## When to build it

Trigger (decision D3): the gateway is built **when auth-service lands** or
when a second PUBLIC service exists. Until then, world-service-as-facade
provides the same public surface with zero extra hops or deploys.
