# Backend source overview

> **Document status:** Active current-source overview; Sprint 1 replacement approved
> **Last source review:** 2026-07-22

> This file describes code present on 2026-07-22. The approved NATS/Redis/DNA
> target is not implemented yet; see
> [../vision/versions/v1-2026-07-22/solution-architecture.md](../vision/versions/v1-2026-07-22/solution-architecture.md) and
> the dated Sprint 1 plan. Re-baseline this overview only after cutover.

The backend is three independent Go modules:

```txt
services/api-gateway
services/universe-service
services/nature-service
```

## Public request flow

```txt
Browser
  -> api-gateway
       RequestContext -> Recover -> Logging -> SecurityHeaders -> CORS
       -> one shared per-client rate limiter -> 64 KiB body limit
       -> /api/universe/* or /api/nature/*
       -> route timeout + per-upstream circuit breaker
       -> sanitized X-Forwarded-* + X-Request-Id + X-Gateway-Key
  -> selected service /api/v1/*
       RequestID -> Recover -> Logging -> GatewayAuthentication
       -> handler validation -> business service -> repository
```

The gateway rewrites paths only. It must never inspect or mutate world input,
DNA, scene config, variants, or share payloads.

## World creation in each peer

Universe:

```txt
POST /api/universe/worlds
  -> universe-service handlers/world_handler.go
  -> services/world_service.go
  -> ai/orchestrator.go -> PersonalityDNA
  -> services/world_config_builder.go -> WorldSceneConfig
  -> repository transaction -> { world, variant, personalityDNA }
```

Nature mirrors the flow at `POST /api/nature/worlds`, using `NatureDNA`,
`forest_config_builder.go`, and `ForestSceneConfig`. Its provider factory wires
mock only until N4; do not claim Gemini/OpenAI runtime support there yet.

Core invariant: AI produces semantics only. All visual numbers come from the
seeded builder. Regeneration creates a new seed/config and makes no AI call.

## API shapes

Both services expose identical direct routes under `/api/v1`:

```txt
POST /worlds
GET  /worlds?ids=...
GET  /worlds/{id}
POST /worlds/{id}/variants
POST /worlds/{id}/variants/{variantId}/select
POST /worlds/{id}/publish
GET  /share/worlds/{slug}
GET  /healthz
GET  /readyz
```

The gateway makes them public under `/api/universe` and `/api/nature`.
Universe responses use `personalityDNA`; Nature responses use `natureDNA`.
Public share models in both services omit raw `WorldInput`.

## Storage

Each peer has its own `repositories.Store`, memory implementation, Postgres
implementation, migration binary, and logical Neon database. Production
refuses the in-memory fallback. Unique collisions surface as
`repositories.ErrConflict` and the service retries with fresh values where the
existing service code defines that behavior.

## AI provider switching

Universe keeps Gemini, OpenAI, and mock adapters under
`internal/ai/providers`. Business code depends only on `ai.Provider`.
`aifactory` reads `AI_PROVIDER`; the orchestrator validates structured output,
repair-retries schema failures, and can use the configured fallback.

Nature has the same interfaces/orchestrator but currently implements mock only.
Its Gemini/OpenAI env names are reserved for N4 and do not imply working
providers.

## Health and security ownership

Gateway:

- `/api/v1/healthz` is liveness;
- `/api/v1/statusz` concurrently checks both protected upstream ready routes;
- CORS and rate limiting exist only here;
- successful public share GETs may be cached for 60 seconds;
- unsafe request IDs and client forwarding headers are replaced;
- transport failures use `UPSTREAM_UNREACHABLE`, `UPSTREAM_TIMEOUT`, or
  `UPSTREAM_CIRCUIT_OPEN` envelopes.

World services:

- direct `/api/v1/healthz` remains public for Render;
- `/api/v1/readyz` and every business/share route require `X-Gateway-Key` when
  configured;
- production startup requires a 32+ character shared key;
- Swagger is mounted only outside production;
- AI keys and gateway secrets are never logged or stored.

There is no user authentication in source.

## Known upgrade boundaries

- The root `contracts/openapi.yaml` is only a health placeholder; the generated
  peer Swagger documents describe direct `/api/v1` routes, not the public
  gateway prefixes.
- Universe scene config has schema 1.2 but no explicit `sceneType`; Forest has
  `sceneType: "forest"`. Contract normalization currently lives in the FE.
- Forest golden fixtures are byte-checked but not validated against their JSON
  Schema in CI; Universe has no equivalent JSON golden set.
- Gateway rate-limit buckets, share cache, and circuit state are process-local.
  This is intentional for one instance and must be revisited before scale-out.
- Logs and request IDs exist, but metrics/distributed tracing do not.
- Nature's provider factory is mock-only. User authentication remains deferred
  until identity/ownership semantics exist.

The prioritized Given/When/Then work is in
`notes/user-stories/engineering-backlog.md`.

## Run and verify

Run Universe on 8080, Nature on 8081, then Gateway on 8082. Each Go module has
the same required gate:

```bash
go mod verify
go vet ./...
go test ./...
go build ./...
```

The gateway local and production env surface is in
`services/api-gateway/.env.example`; domain env files remain service-specific.

For the integrated local path, root `docker-compose-local.yml` starts both
PostgreSQL databases and migrations before the two APIs, waits for both APIs
before the gateway, then builds the web client against
the single `NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:8082` origin. Run it
with the default VS Code build task,
`docker compose -f docker-compose-local.yml up --build`, or `make local-up`.
The root stack supplies one development-only gateway key to all three backend
processes so business traffic exercises the same gateway authentication
boundary as deployment.
