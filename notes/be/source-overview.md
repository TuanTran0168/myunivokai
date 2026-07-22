# Backend source overview

> **Document status:** Implemented; container/deployed smoke evidence pending
> **Last source review:** 2026-07-22

The backend now consists of one public HTTP edge and three private NATS
services. The old gateway-to-domain HTTP proxy, duplicated family AI layers,
public domain handlers, and `GATEWAY_SHARED_SECRET` runtime have been removed.

## Runtime topology

```text
myunivokai-web
  -> API Gateway (HTTP :8080)
       -> JetStream MYUNIVOKAI_COMMANDS
       -> Core NATS queries
       -> Redis rate/cache

DNA Service
  -> myunivokai_dna
  -> AI Provider interface (mock/gemini/openai)
  -> Universe or Nature compose command

Universe Service -> myunivokai_universe
Nature Service   -> myunivokai_nature
```

Only Gateway starts an HTTP server. Domain services run `cmd/service`, consume
durable commands, publish outbox events, and register Core NATS queue
responders. Their Render resource type is Background Worker, with no `-worker`
name suffix.

## Shared contracts

`contracts/go` is a small Go module used by every backend module. NATS messages
always have exactly these top-level fields:

```json
{
  "jobId": "...",
  "timestamp": "2026-07-22T12:00:00Z",
  "data": {}
}
```

Family/profile/world identifiers are inside typed `data`. Subjects carry the
domain, operation, and V1 version. JSON schemas and fixed examples live in
`contracts/schemas` and `contracts/fixtures`; the public browser contract is
`contracts/openapi.yaml`.

## API Gateway

Source: `services/api-gateway`.

- `internal/handlers`: async generation and family-neutral public routes.
- `internal/broker`: JetStream publish and Core NATS request-reply.
- `internal/edge`: Redis cache and atomic distributed token bucket.
- `internal/middleware`: request identity, headers, CORS, body limit, logging,
  recovery, and Redis-first rate limit with local fallback.
- `internal/config`: NATS/Redis/cache/edge configuration and production CORS
  validation.

`POST /api/{family}/worlds` returns `202` only after a JetStream `PubAck`.
Reads/mutations have a bounded NATS request timeout. Redis does not transport
jobs; it may be flushed without losing accepted commands or persisted worlds.

## DNA Service

Source: `services/dna-service`.

- owns raw `WorldInput`, profiles, root jobs, immutable DNA versions, provider
  attempts, inbox, and outbox;
- is the only service with provider adapters under `internal/ai/providers`;
- business logic depends on `ai.Provider`, not provider-specific clients;
- validates AI JSON before persistence and records a hash instead of raw prompt
  input in attempt telemetry;
- publishes one requested family compose command containing an immutable
  ProfileDNA snapshot;
- consumes family completion/failure and answers job queries.

The default mock provider keeps local tests deterministic at the contract level
without external calls. Variant regeneration remains inside family services and
does not call AI.

## Universe and Nature services

Sources: `services/universe-service` and `services/nature-service`.

Both use the same layers:

```text
cmd/service -> internal/messaging -> internal/services
            -> internal/repositories -> PostgreSQL
```

Each service:

- consumes only its versioned compose subject;
- maps family-neutral facets into its existing deterministic scene builder;
- atomically records inbox + world + initial variant + completion outbox;
- returns the existing world/variant/publish/share JSON shapes over Core NATS;
- preserves UUID validation at Gateway and privacy-safe public projections;
- supports idempotent compose redelivery and AI-free variants;
- stores `profileId`, `dnaVersionId`, source job, visual intent, and DNA
  snapshot in its own database.

Universe scene configs now explicitly include `sceneType: "universe"`; Nature
continues to use `sceneType: "forest"`. The frontend registry remains
sceneType-first.

## Persistence

Fresh V1 database names:

| Owner | Database |
| --- | --- |
| DNA Service | `myunivokai_dna` |
| Universe Service | `myunivokai_universe` |
| Nature Service | `myunivokai_nature` |

There are no cross-database foreign keys. IDs and immutable snapshots cross
boundaries only through NATS contracts. Outbox messages are retried until
JetStream acknowledges them; consumer inbox keys prevent duplicate effects.

## Internal access boundary

V1 intentionally has no auth/account service. Direct browser-to-domain access
is prevented structurally:

- domain services have no HTTP listener or published host port;
- the browser receives only the Gateway origin;
- local NATS users have subject-scoped publish/subscribe permissions;
- production uses managed NATS credentials and TLS;
- each service receives only its own Neon URLs.

## Development checks

Run the root Compose config gate, then the checks in each Go module:

```powershell
docker compose --env-file .env.local -f docker-compose-local.yml config --quiet
go test ./...
go vet ./...
go build ./...
```

The complete local/deployment workflow is in
`notes/sprints/sprint-01-2026-07-22/`. Source compilation and unit/regression
tests pass as of the review date. A real container smoke requires a running
Docker engine; managed deployment additionally requires operator credentials.
