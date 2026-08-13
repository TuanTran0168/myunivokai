# Sprint 05 user stories — telemetry-service

> **Document status:** Planned
> **Sprint starts:** 2026-08-13
> **Last source review:** 2026-08-13

One epic, nine stories, ordered by dependency. `S5-TELEMETRY-001` (the shared
contract) blocks everything and lands first, for the same reason
`analytics-service-plan.md` put its contract phase first: a fixture both
languages test against is cheap now and expensive to retrofit once two
independent guesses at the shape already exist.

`S5-TELEMETRY-002` (the gateway collector) can then run in parallel with
`S5-TELEMETRY-003`/`004` (the Rust service), because envelopes accumulate on
`MYUNIVOKAI_EVENTS` with no consumer, exactly as analytics' events did before
phase 2 of that plan. `S5-TELEMETRY-007` (the admin routes) is the first story
that needs both halves alive at once.

## EPIC-S5-TELEMETRY-001 — Operational telemetry and the first Rust service

### S5-TELEMETRY-001 — Freeze the rollup contract in two languages

Status: Planned
Priority: P0

As a service developer,
I want the rollup envelope defined once in Go and once in Rust, both tested
against the same fixture file,
so that a second language in the repository cannot silently drift from the
first.

Scenario: One fixture, two decoders

Given `contracts/fixtures/telemetry-http-rollup-event.v1.json` exists
When the Go contract test and the Rust contract test both run in CI
Then both decode that exact file into their own struct and assert the same
field values
And the Go test additionally validates it against
`contracts/schemas/message-envelope.schema.json`, like every other fixture.

Scenario: Drift fails the build rather than production

Given a developer changes a field name on the Go side only
When CI runs
Then the Rust fixture test fails on the missing field
And no decode error is discovered in a deployed service instead.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Rust contracts, §Phases (phase 0)
- notes/vision/rust-adoption-research.md — §Re-scoring Track C's four criteria, criterion 3

Tasks:
- [ ] Add `HTTPRollupEnvelope`, `HTTPRollupBucket`, `NATSBackendBucket`, `CacheBucket`, the query/response types and the subject constants to `contracts/go` as `contracts_telemetry_rollup.go` — separate from the existing `contracts_telemetry.go`, which is fleet start telemetry and a different concern.
- [ ] Create the `contracts/rust` crate mirroring `Envelope<T>`, the RPC envelope shapes and the rollup types.
- [ ] Add the shared fixture and the decode test on both sides.

### S5-TELEMETRY-002 — Aggregate the gateway's own activity in memory

Status: Planned
Priority: P0

As a platform operator,
I want the gateway to aggregate what it is doing and publish one summary per
minute,
so that request volume, latency and error mix become answerable without
putting a broker publish on the hot path.

Scenario: One envelope per interval, not one per request

Given `TELEMETRY_ENABLED=true` and a flush interval of 60 seconds
When the gateway serves any number of requests during an interval
Then exactly one message is published on
`myunivokai.events.telemetry.http.v1` for that interval
And it carries HTTP buckets, per-backend NATS round-trip buckets and Redis
cache hit/miss counters together, not three separate messages.

Scenario: The cardinality rule holds

Given a request to `/api/universe/worlds/01K0EXAMPLE000000000000014`
When the collector records it
Then the bucket's route pattern is `/api/universe/worlds/{worldID}`
And no bucket key anywhere contains a world id, job id, share slug or client
address.

Scenario: Telemetry never changes what a client sees

Given `TELEMETRY_ENABLED` is unset, which is its default
When any request is served
Then no bucket is recorded, no ticker runs and nothing is published
And every response is identical to the one the same build serves today.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Gateway-side work (Go), §Durability and wake
- notes/vision/platform-evolution-research.md — §B2, the cardinality rule
- notes/vision/telemetry-architecture-research.md — §The number that was missing

Tasks:
- [ ] Add `services/api-gateway/internal/telemetry/collector.go` — the in-memory bucket map, the histogram edges, and `Snapshot` returning one envelope's worth of buckets and resetting.
- [ ] Record HTTP buckets from a middleware that reads `chi.RouteContext(...).RoutePattern()` **after** the handler chain has run, and error codes from the gateway's own error writer.
- [ ] Record NATS round-trip buckets in `RPCTransport.Request`, keyed on `wake.ServiceForSubject(subject)` — the value it already computes.
- [ ] Record cache hits and misses at the three existing `job:v1`/`world:v1`/`share:v1` lookup sites.
- [ ] Add the flusher: a ticker plus one final flush on graceful shutdown, publishing through JetStream (`js.Publish`), never Core NATS.
- [ ] Add `TELEMETRY_ENABLED` and `TELEMETRY_FLUSH_INTERVAL` to gateway config, defaulting to off.

### S5-TELEMETRY-003 — Stand up telemetry-service and its durable consumer

Status: Planned
Priority: P0

As a platform operator,
I want a service that survives being asleep for a week and still catches up,
so that a rollup published while nothing was listening is not simply lost.

Scenario: Sleep does not lose data

Given `telemetry-service` is asleep and the gateway flushes several intervals
When the service next starts
Then its durable JetStream consumer resumes from its last acknowledged
message and processes every envelope published while it was down
And nothing depends on the service being subscribed at publish time.

Scenario: A sink is chosen once, at boot

Given `TELEMETRY_SINK=postgres`
When the service starts
Then it builds exactly one sink, logs which one, and the rest of the service
is written against the `TelemetrySink` trait rather than a concrete type
And an unknown value stops the process at startup instead of running with a
silently-wrong destination.

Source evidence:
- notes/vision/telemetry-service-plan.md — §The `TelemetrySink` trait, §Phases (phase 2)
- services/analytics-service/internal/messaging/runtime.go — the durable-consumer shape being mirrored

Tasks:
- [ ] Create `services/telemetry-service` with `main.rs`, `config.rs` (env-first, dotenv second, matching every Go service's `loadEnvironmentFiles`), and the `TelemetrySink` trait.
- [ ] Implement the durable pull consumer on `MYUNIVOKAI_EVENTS` filtered to the telemetry subject, `max_deliver: -1` mirroring `dnaResultsDurableName`.
- [ ] Serve `/healthz` on `PORT` with `axum`, bound before the consumer starts, so a cold start has an inbound HTTP target.
- [ ] Add a `Dockerfile.local`, a `Dockerfile.prod` and a `README.md` runbook alongside the other services'.

### S5-TELEMETRY-004 — Store rollups in the service's own database

Status: Planned
Priority: P0

As a platform operator,
I want the rollups in a schema this repo owns,
so that the admin app can chart them without a vendor in the loop.

Scenario: A redelivery is not a double count

Given an envelope that has already been stored
When JetStream delivers it a second time
Then the inbox row short-circuits the write and no counter moves
And the message is acknowledged rather than redelivered forever.

Scenario: Percentiles admit what they are

Given a p95 computed from the fixed histogram buckets
When it is returned to the admin app
Then the response marks it as an interpolation over bucket edges, not an exact
value, and the screen renders that qualification next to the number.

Scenario: Retention is enforced, not documented

Given rows older than `TELEMETRY_RETENTION_DAYS`
When the retention ticker runs
Then those rows are deleted from every rollup table.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Data model, §What this service tracks
- services/analytics-service/internal/services/projection_service.go — the inbox idempotency shape being mirrored

Tasks:
- [ ] Add `migrations/0001_init.sql`: `http_rollups`, `error_code_rollups`, `nats_rollups`, `cache_rollups`, `inbox_messages`.
- [ ] Implement `sinks::postgres::PostgresSink::write_rollup` — one transaction per envelope, inbox insert first, `ON CONFLICT` accumulation for every bucket table.
- [ ] Implement the overview and per-route queries, including the `SERVICE_WAKING` count that answers the wake-conversion question.
- [ ] Implement the retention ticker.
- [ ] Test the histogram/percentile interpolation and the envelope→row mapping without a database.

### S5-TELEMETRY-005 — Forward to Grafana Cloud instead, on one switch

Status: Planned
Priority: P1

As a platform operator,
I want the same rollups pushed to Grafana Cloud when I ask for it,
so that alerting is available without building it here.

Scenario: The switch is the only difference

Given `TELEMETRY_SINK=otlp`
When an envelope arrives
Then each bucket is exported as OTLP metric points and nothing is written to
any database
And no other part of the service changes behaviour.

Scenario: A missing chart reads as "look elsewhere"

Given the OTLP sink cannot answer a range query, because Grafana owns the
query surface once data is pushed there
When the admin app asks for the overview
Then the service answers with an explicit "charts live in Grafana" payload
carrying the configured dashboard URL, rather than an error or an empty chart.

Source evidence:
- notes/vision/telemetry-service-plan.md — §The `TelemetrySink` trait, §Admin surface

Tasks:
- [ ] Implement `sinks::otlp::OtlpSink::write_rollup`.
- [ ] Return the "charts are elsewhere" response shape from `query_range`, carrying `TELEMETRY_DASHBOARD_URL`.
- [ ] Document in the service README why a pre-aggregated histogram is exported as bucket counters rather than replayed through an OTLP histogram instrument.

### S5-TELEMETRY-006 — Wake telemetry-service like every other service

Status: Planned
Priority: P0

As a staff member,
I want opening the Telemetry screen to start the service if it is asleep,
so that an idle read model does not blank a screen.

Scenario: No special case is added

Given a query on `myunivokai.queries.telemetry.overview.get.v1`
When it finds no responder
Then `wake.ServiceForSubject` resolves `telemetry` by the same prefix rule
every other service resolves by, with no telemetry-specific branch
And the gateway answers `503 SERVICE_WAKING` with `Retry-After` and starts the
service.

Scenario: The two lists cannot drift

Given `wake.ServiceTelemetry` is added to `wake.Services`
When `TELEMETRY_SERVICE_URL` is not added to `serviceWakeURLKeys`
Then `internal/config/wake_config_test.go` fails.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Durability and wake
- services/api-gateway/internal/config/wake_config_test.go

Tasks:
- [ ] Add `wake.ServiceTelemetry` to `internal/wake/platform.go` (constant, `Services`, and `ServiceForSubject`'s switch).
- [ ] Add `"telemetry": "TELEMETRY_SERVICE_URL"` to `serviceWakeURLKeys`.

### S5-TELEMETRY-007 — Relay the telemetry reads through /api/admin

Status: Planned
Priority: P0

As a staff member,
I want the telemetry reads on the existing admin API,
so that they inherit its authentication, permissions, rate limit and CORS
rather than growing a second protected surface.

Scenario: A pure relay, like every other admin read

Given `GET /api/admin/telemetry/overview`
When the gateway handles it
Then it publishes exactly one `myunivokai.queries.telemetry.*` subject and
returns the reply payload unchanged
And it sums, groups and merges nothing.

Scenario: Default deny still holds

Given the enumerating admin router test
When the two new routes are registered
Then both reject an unauthenticated request and both require `chart:read`.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Admin surface
- services/api-gateway/internal/handlers/admin_analytics_handler.go — the relay being mirrored

Tasks:
- [ ] Add `admin_telemetry_handler.go` with `Overview` and `Routes`.
- [ ] Register both under `chart:read` in `admin_router.go`.
- [ ] Extend `contracts/openapi-admin.yaml` with both routes and their response schemas.

### S5-TELEMETRY-008 — Deploy telemetry-service

Status: Planned
Priority: P1

As a platform operator,
I want the service deployable by the same blueprint every other service uses,
so that a second language does not become a second deployment procedure.

Scenario: The blueprint describes the whole fleet

Given `render.yaml`
When `myunivokai-telemetry` is added
Then it is a `type: web` free service with a two-stage `Dockerfile.prod`, like
every other service
And the gateway block gains `TELEMETRY_SERVICE_URL` as a sixth `sync: false`
entry, blank on first sync like the other five.

Scenario: CI covers the second language

Given the new `telemetry-service-checks` job
When CI runs
Then `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` and
`cargo build --release` all run, plus the fixture-decode test from
`S5-TELEMETRY-001`.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Deploy and CI additions
- notes/ops/auth-analytics-first-deploy-checklist.md — why no new NATS user is needed in production

Tasks:
- [ ] Add the `myunivokai-telemetry` block and the gateway's `TELEMETRY_SERVICE_URL` to `render.yaml`.
- [ ] Add the `telemetry-service-checks` and `contracts-rust-checks` CI jobs.
- [ ] Add the local-only NATS ACL block and the local compose service.
- [ ] Add every new variable to `.env.example`, and the "why one service is not Go" paragraph to `notes/be/source-overview.md`.

### S5-TELEMETRY-009 — Show telemetry in the admin app

Status: Planned
Priority: P1

As a staff member,
I want a Telemetry screen,
so that request volume, status mix and per-route latency are visible where
every other operational answer already is.

Scenario: The screen is honest about its numbers

Given the overview renders a p95
When a reader looks at it
Then the interpolation qualifier is visible next to the number, not buried in
a tooltip nobody opens.

Scenario: The screen is honest about its sink

Given the service is running with `TELEMETRY_SINK=otlp`
When the screen loads
Then it shows the "charts live in Grafana" state with a link, instead of empty
charts.

Source evidence:
- notes/vision/telemetry-service-plan.md — §Admin surface
- apps/myunivokai-admin/src/features/analytics/FleetPage.tsx — the screen being mirrored

Tasks:
- [ ] Add the `telemetry` feature folder: `api.ts`, `types.ts`, `TelemetryPage.tsx`, the volume/status charts and the per-route table.
- [ ] Add the `/telemetry` route and the nav entry, gated on `chartRead`.

### DEFERRED-S5-NAV-001 — Restructure the admin navigation

Status: Deferred by owner decision on 2026-08-13
Priority: Post-Telemetry

As a staff member,
I want the sidebar grouped by concern once it holds eight entries,
so that product, platform and administration screens stop reading as one flat
list.

Not started until `S5-TELEMETRY-009` ships and the sidebar demonstrably feels
crowded. The two candidate directions — grouped sections inside the existing
sidebar, or a top-level section switcher — are described in
[telemetry-service-plan.md §Future dependency](../../vision/telemetry-service-plan.md#future-dependency-the-admin-navigation-needs-restructuring-once-this-ships),
which takes no position between them. Whoever revisits it starts from
`apps/myunivokai-admin/src/components/layout/nav-config.ts`, whose existing
comment already describes the implicit split in prose.
