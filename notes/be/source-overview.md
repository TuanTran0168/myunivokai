# BE Source Overview — services/universe-service

Go + chi router + pgxpool. One binary `cmd/api`, one migration tool `cmd/migrate`.

## World creation request flow

```txt
POST /api/v1/worlds
  -> handlers/world_handler.go   decode + validate request (validation/world.go)
  -> services/world_service.go   orchestrates everything
      -> ai/orchestrator.go      call primary provider, validate JSON, repair-retry, fallback
      -> seed/seed.go             generate WLD-XXXXXXXXXX seed (crypto random)
      -> services/world_config_builder.go
                                 DNA + seed -> WorldSceneConfig (deterministic PRNG, seed/prng.go)
  -> repositories (store)         save world + variant + AI logs in one transaction
  -> returns { world, variant, personalityDNA }
```

Core principle: **AI only generates Personality DNA** (semantics). Every 3D
number (orbit, size, speed) is produced by `world_config_builder` from the seed
within safe bounds. Regenerating a variant therefore makes NO AI call — just a
new seed + rebuilt config.

## AI provider switching

- `ai/provider.go` — `Provider.GenerateStructured()` interface. Business code only knows this interface.
- `ai/providers/` — Gemini + OpenAI adapters (plain REST in `rest.go`), `mock.go` for tests/dev.
- `aifactory/factory.go` — reads `AI_PROVIDER` (gemini | openai | mock) and builds the provider.
- `ai/orchestrator.go` — repair-prompt retry on schema-invalid JSON (AI_MAX_RETRIES),
  fallback to `AI_FALLBACK_PROVIDER` on technical failures.
- Switching providers = changing env, never code. Provider request shapes must
  not leak outside the `providers/` folder.
- Gemini accepts only an OpenAPI-style schema subset, while OpenAI strict mode
  REQUIRES `additionalProperties:false`; `sanitizeSchemaForGemini` in rest.go
  reconciles this, with tests locking both invariants.

## Store

`repositories/store.go` is the interface; two implementations:

- `postgres_store.go` — real Neon/Postgres (`DATABASE_URL`), pool tuned via
  `DATABASE_MAX_CONNS` / `MIN_CONNS` / `MAX_CONN_LIFETIME` / `MAX_CONN_IDLE_TIME`.
- `memory_store.go` — auto-selected when `DATABASE_URL` is empty. FE dev needs no database.
  It enforces the same uniqueness rules as Postgres so behavior never diverges.

Unique-constraint collisions surface as `repositories.ErrConflict`; the service
retries with fresh values (variant numbers, share slug suffixes).

## Response shapes (the FE depends on these directly)

Defined in `models/responses.go`:

```txt
POST /worlds            -> { world, variant, personalityDNA }
GET  /worlds/{id}       -> { world, selectedVariant, variants, personalityDNA }   <- variants at ROOT
GET  /share/worlds/{s}  -> { world, variant, publicDNA }                          <- world has no id/input
```

If you change a shape here, update `clients/web-client/src/lib/api.ts`
(normalize functions) in the same PR.

## Health & security

- `GET /api/v1/healthz` — liveness, touches no dependency.
- `GET /api/v1/readyz` — pings the store (3s timeout), 503 when unreachable.
- Share APIs never return raw `input` (user goal/challenge) — see `PublicWorld`.
- Rate limiting is per client IP (X-Forwarded-For behind the proxy).
- Swagger UI is mounted only outside production.
- No API keys are ever logged or stored. AI request/response/usage go to `ai_generations`.

## Run locally & checks

```bash
cd services/universe-service
go run ./cmd/api        # empty DATABASE_URL -> memory store, AI_PROVIDER=mock by default
go test ./...
go vet ./...
```

Swagger (non-production): http://localhost:8080/swagger/index.html — regenerate with
`swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal`.
