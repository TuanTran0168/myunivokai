# Backend source overview

> **Document status:** Implemented; local container smoke passed, deployed smoke pending
> **Last source review:** 2026-08-07 (added auth-service and analytics-service)

The backend consists of one public HTTP edge and five private NATS services.
The old gateway-to-domain HTTP proxy, duplicated family AI layers, public
domain handlers, and `GATEWAY_SHARED_SECRET` runtime have been removed.

Three of the five compose worlds (dna, universe, nature). The other two serve
the staff console: `auth-service` owns identity, and `analytics-service` is a
CQRS read model that exists so an admin page never has to wake a domain
service.

## Runtime topology

```text
myunivokai-web
  -> API Gateway (HTTP :41800 local, PORT on Render)
       -> JetStream MYUNIVOKAI_COMMANDS
       -> Core NATS queries
       -> Redis rate/cache

DNA Service
  -> myunivokai_dna
  -> AI Provider interface (mock/gemini/openai)
  -> Universe or Nature compose command

Universe Service -> myunivokai_universe
Nature Service   -> myunivokai_nature

myunivokai-admin
  -> API Gateway (/api/admin/*, cookie session)
       -> Core NATS queries -> Auth Service      -> myunivokai_auth + Redis
       -> Core NATS queries -> Analytics Service -> myunivokai_analytics

Analytics Service
  <- JetStream MYUNIVOKAI_EVENTS (durable, wildcard myunivokai.events.>)
```

Only Gateway serves business HTTP. Every other service runs `cmd/service`,
consumes durable commands or events, publishes outbox events, and registers
Core NATS queue responders. They each bind a bare `/healthz` port so Render's
free tier has an inbound target to cold-start against; they are declared as
`type: web` in `render.yaml` for that reason, not because they serve an API.

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

- `internal/handlers`: separate DNA job, Universe, and Nature HTTP adapters over
  one shared RPC/cache transport. Each family handler receives fixed NATS
  subjects at construction time; request data cannot reroute between services.
- `internal/broker`: JetStream publish and Core NATS request-reply.
- `internal/edge`: Redis cache and atomic distributed token bucket.
- `internal/middleware`: request identity, headers, CORS, body limit, logging,
  recovery, and Redis-first rate limit with local fallback.
- `internal/config`: NATS/Redis/cache/edge configuration and production CORS
  validation.

- `internal/wake`: starts services that a scale-to-zero host has put to sleep,
  shaped after `internal/ai` in dna-service — dumb per-platform adapters under
  `wake/platforms`, one coordinator holding the shared policy, `wake/factory`
  holding the switch. Deliberately one self-contained directory: it is a
  hosting workaround, and its package doc lists every call site outside itself
  so deleting it later is mechanical.

`POST /api/{family}/worlds` returns `202` only after a JetStream `PubAck`.
Reads/mutations have a bounded NATS request timeout. Redis does not transport
jobs; it may be flushed without losing accepted commands or persisted worlds.

Because every other service is a pure NATS consumer, nothing sends them the
inbound HTTP a sleeping instance needs to wake. The gateway therefore splits
`no-responders` (nobody subscribed — starts the service, answers `503
SERVICE_WAKING` with `Retry-After`) from a deadline (`504 SERVICE_TIMEOUT`)
from any other broker fault (`503 SERVICE_UNAVAILABLE`), where it used to
report one code for all three. Reads wake reactively; `POST .../worlds` wakes
proactively, since a JetStream publish succeeds with no consumer alive and so
produces no error to react to. `SERVICE_WAKE_PLATFORM=none` is the default and
the correct value on an always-on host. See
`notes/vision/service-wake-mechanism.md`.

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

The default mock provider makes no external call but intentionally selects
between multiple ProfileDNA presets per mood and randomizes facet energy. Its
random-index strategy is injected in tests, preserving deterministic assertions
without removing runtime variety. Variant regeneration remains inside family
services and does not call AI.

## Universe and Nature services

Sources: `services/universe-service` and `services/nature-service`.

Both use the same layers:

```text
cmd/service -> internal/messaging runtime -> internal/handlers NATS adapters
            -> internal/services -> internal/repositories -> PostgreSQL
```

Each service:

- consumes only its versioned compose subject;
- registers explicit Core NATS handlers for list/get/variant/publish/share;
- maps family-neutral facets into its existing deterministic scene builder;
- atomically records inbox + world + initial variant + completion outbox;
- returns the existing world/variant/publish/share JSON shapes over Core NATS;
- preserves UUID validation at Gateway and privacy-safe public projections;
- supports idempotent compose redelivery and AI-free variants;
- stores `profileId`, `dnaVersionId`, source job, visual intent, and DNA
snapshot in its own database.

The runtime owns connection lifecycle, deterministic subscription registration,
pull/ack/retry policy, and outbox polling. Fetch size/wait, retry delay,
connect/reconnect timing, publish timeout, ack wait, and maximum deliveries are
configuration values. Every inbound envelope is validated before its service is
called, and a terminal compose message is acknowledged only after its failure
event receives a JetStream acknowledgement.

DNA generation commands use bounded redelivery. After the configured maximum,
DNA Service durably creates/updates the root job as failed and queues its failure
event before terminating the poison command. Family result events use unlimited
redelivery so a temporary DNA database outage cannot silently drop the final
job state.

Universe scene configs now explicitly include `sceneType: "universe"`; Nature
continues to use `sceneType: "forest"`. The frontend registry remains
sceneType-first.

## Auth Service

Source: `services/auth-service`.

A pure Core NATS request-reply worker: no JetStream command to pull, no domain
event to publish, so it has neither a `PullSubscribe` nor an outbox loop. It
answers login/refresh/logout, account and role management, permission lookups
and the audit list, and writes a `tokenVersion` key to the gateway's Redis so
a disabled account's still-valid access token can be rejected without a
per-request round trip.

`internal/repositories` keeps one `Store` interface per backend
(`PostgresStore`, `MemoryStore`) like every other service; what is split per
concern is the *file* (`postgres_accounts.go`, `postgres_audit.go`, …), not
the type.

## Analytics Service

Source: `services/analytics-service`. Design:
`notes/vision/analytics-service-plan.md`.

The admin read model, and the one service in this repo whose shape is
deliberately asymmetric:

- **No `outbox_messages` table and no publish loop.** It consumes events,
  writes its own database and answers queries — it publishes nothing and calls
  no other service. An outbox appearing here is a design violation.
- **Its NATS user may publish no domain subject at all**, only `$JS.API.>`,
  `$JS.ACK.>` and `_INBOX.>`. Locally the ACL enforces the rule; in production
  every service shares one NGS account user, so there only the code does.
- **One durable consumer** (`analytics-events-v1`) on `MYUNIVOKAI_EVENTS`,
  filtered on the wildcard `myunivokai.events.>` with `MaxDeliver(-1)`. It is
  invisible to `dna-service`, whose consumer filters four explicit subjects.

Each delivery writes an `inbox_messages` row and its projection in one
transaction. Worlds move forward only —
`WHERE world_projections.revision < EXCLUDED.revision` — which is what makes
JetStream's duplicate and out-of-order delivery harmless without the consumer
ordering anything itself. Job timestamps come from envelope fields stamped by
the publishing service, never a local clock, because a job spans three
processes and only the envelope is common to all of them.

Reads are four query subjects on the `analytics-service-v1` queue group.
Every aggregate is SQL here; the gateway sums nothing. Pagination is keyset on
`(timestamp, id)` — never `OFFSET` — so page 1000 costs what page 1 costs and
the response stays inside the 2500ms request/reply deadline as the table
grows.

**The cost this design keeps charging:** every future mutation in universe or
nature must bump `worlds.revision` and write a `world.changed` outbox row in
the same transaction, or the read model drifts silently. The guard is
`internal/repositories/world_snapshot_test.go` in both family services, which
asserts every mutating store method leaves an event behind.

## Persistence

Fresh V1 database names:

| Owner | Database |
| --- | --- |
| DNA Service | `myunivokai_dna` |
| Universe Service | `myunivokai_universe` |
| Nature Service | `myunivokai_nature` |
| Auth Service | `myunivokai_auth` |
| Analytics Service | `myunivokai_analytics` |

There are no cross-database foreign keys. IDs and immutable snapshots cross
boundaries only through NATS contracts. Outbox messages are retried until
JetStream acknowledges them; consumer inbox keys prevent duplicate effects.

`myunivokai_analytics` is the one deliberate exception to "each row lives in
exactly one place": it is a second copy of production data, so what may enter
it is an allow list (`contracts.WorldSnapshot`), not a projection of the
source row. `nickname` is the only user-entered value that crosses; raw form
input, generated profiles, world quotes, variant configs and share slugs
never do.

## Internal access boundary

The product API still has no end-user accounts; `auth-service` is staff-only
identity for the admin console (`notes/vision/auth-and-admin-plan.md`).
Direct browser-to-domain access is prevented structurally:

- domain services have no HTTP listener or published host port;
- the browser receives only the Gateway origin;
- local NATS users have subject-scoped publish/subscribe permissions;
- production uses managed NATS credentials and TLS;
- each service receives only its own Neon URLs.

## Development checks

Run the root Compose config gate, then the checks in each Go module:

```powershell
docker compose -f docker-compose-local.yaml config --quiet
go test ./...
go vet ./...
go build ./...
```

The complete local/deployment workflow is in
`notes/sprints/sprint-01-2026-07-22/`. Source compilation and unit/regression
tests pass as of the review date. On 2026-07-22 UTC, the root stack built and
started on Docker Engine 27.4.0; all health checks passed and mock-provider
Universe and Nature jobs completed through Gateway, NATS, DNA, their family
service, and PostgreSQL. Managed deployment still requires operator
credentials. All five two-stage production images also build successfully.

Production promotion is not yet approved: the audit identified high-severity
advisories in the current Next.js 14 production tree. Sprint story
`S1-SECURITY-001` requires an isolated framework upgrade plus browser
regression before cutover; this backend migration does not silently waive or
bundle that behavior-sensitive major upgrade.
