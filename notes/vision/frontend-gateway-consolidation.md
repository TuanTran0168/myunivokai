# FE chỉ biết một URL gateway

> **Document status:** Implemented and active
> **Last source review:** 2026-07-22

> The one-origin invariant remains active after Sprint 1. Family prefixes stop
> being reverse-proxy destinations and become public gateway contracts backed
> by NATS commands/queries; the browser still receives no domain-service URL.

Status: **IMPLEMENTED** on `feat/repo/render-gateway-deployment` (2026-07-18).

## Contract

The browser receives exactly one API location:

```txt
NEXT_PUBLIC_GATEWAY_BASE_URL=https://<gateway-host>
```

This value is an origin only: no credentials, path, query, or fragment. The
frontend fails its build for an explicitly malformed value instead of shipping
an unusable API client.

`clients/web-client/src/lib/gateway.ts` owns the public family prefixes:

```txt
universe -> <gateway-origin>/api/universe
nature   -> <gateway-origin>/api/nature
```

The gateway remains the only component that knows `UNIVERSE_SERVICE_URL` and
`NATURE_SERVICE_URL`. It rewrites those public prefixes to the peers' common
`/api/v1/*` contract. The frontend never stores or calls a peer-service host.

## Source integration

The same helper is used by:

- the family-aware browser API client in `src/lib/api.ts`;
- server-side metadata fetches for both share routes;
- the header's gateway route-index link;
- local Docker builds and the Render web-client build.

`gateway.test.ts` verifies URL validation and both family routes. Adding a
third family requires one new prefix in the helper and one matching gateway
route; it does not require another frontend environment variable.

## Deployment and local development

`render.yaml` declares the Next.js client as `myunivokai-web`, a Docker web
service alongside the gateway and two peer APIs. During Blueprint creation,
set `NEXT_PUBLIC_GATEWAY_BASE_URL` to the gateway's public HTTPS origin. Render
passes service environment variables to Docker as build arguments, which is
required because `NEXT_PUBLIC_*` values are compiled into the Next.js bundle.
The production Docker build fails when this argument is missing, preventing a
Render image from silently embedding the localhost development fallback.

The root `docker-compose-local.yml` uses the same contract:

```txt
NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:8082
```

All browser business traffic therefore exercises Gateway CORS, rate limiting,
request verification, routing, and the upstream shared-secret boundary in both
local and deployed environments.

## Historical reason for the change

Before the gateway, Universe and Nature had distinct public hosts, so the
frontend needed `NEXT_PUBLIC_API_BASE_URL` and
`NEXT_PUBLIC_NATURE_API_BASE_URL`. The first gateway rollout preserved those
two variables and pointed both at one host with different suffixes. Once the
gateway became the required public edge, keeping two independently editable
host values created configuration drift without providing a useful boundary.

The old variables are removed rather than retained as fallbacks. A fallback
would allow a deployment to bypass the gateway silently, which would also
bypass its CORS, rate-limit, and request-verification policies.
