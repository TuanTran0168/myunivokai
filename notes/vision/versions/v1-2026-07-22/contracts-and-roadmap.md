# Contracts, roadmap, and risks

> **Document status:** Active; Sprint 1 source inventory implemented
> **Vision version:** v1-2026-07-22
> **Last source review:** 2026-07-22

This roadmap is governed by
[solution-architecture.md](solution-architecture.md). Sprint 1 source now uses
the event-driven V1 contracts; live cutover evidence is still pending.

## Contract inventory

| Contract | Implemented source | Remaining verification |
| --- | --- | --- |
| Public API | versioned generation/job/family/share OpenAPI; create returns `202 + jobId` | deployed lifecycle smoke |
| Messaging | generic `jobId/timestamp/data` envelope and typed V1 Go contracts/fixtures | managed NATS compatibility/ACL negative smoke |
| DNA | family-neutral `ProfileDNA` owned by `dna-service` | real-provider staging smoke when enabled |
| Universe scene | explicit `sceneType: universe`, deterministic tests | container/browser regression |
| Nature scene | Forest schema 1.2 and golden tests retained | container/browser regression |
| Edge state | Redis distributed limiter and cache-aside with fallback | two-Gateway/Redis outage smoke |
| Persistence | fresh `myunivokai_dna`, `myunivokai_universe`, `myunivokai_nature` migrations | empty Neon/local database migration smoke |
| Internal trust | no domain HTTP API; local NATS subject ACLs | managed credential and database negative checks |
| Local runtime | root include aggregator, shared `infra/`, component Compose and `.env.local` | real Docker engine full-stack smoke |
| Production | Gateway web + DNA/Universe/Nature Background Workers | operator deploy/cutover/rollback evidence |

## Compatibility policy

- Sprint 1 is allowed to break the old API and discard old persisted data.
- The new public API, NATS subjects and database migrations start at version 1.
- After cutover, additive optional fields require deterministic defaults;
  breaking changes require a new subject/schema/API version and a migration or
  compatibility reader.
- Saved new-platform worlds must render after later deployments.
- PRNG changes use new named streams and never shift existing draw sequences.
- NATS schemas and frontend/Go types must have CI drift checks.
- Redis keys are cache versions, not domain schema versions.

## Roadmap

| Timebox | Outcome | Exit |
| --- | --- | --- |
| Sprint 1, starts 2026-07-22 | Full event-driven migration and production cutover | NATS/Redis/DNA/family services/fresh DBs/FE/Compose/Render/runbook all work; deployed smoke passes |
| Sprint 2, starts 2026-08-05 | Scale and resilience proof | two-gateway limiter semantics, consumer scale tests, dependency-failure recovery, metrics/traces and SLO dashboard pass |
| Sprint 3, starts 2026-08-19 | City vertical slice on the new platform | City contracts, service/database/subjects and high-fidelity desktop flow pass without changing existing consumers |
| Deferred | User authentication | issuer, ownership, anonymous migration and object authorization are approved first |

Detailed acceptance criteria live in
[engineering-backlog.md](../../../user-stories/engineering-backlog.md) and the dated
[sprint index](../../../sprints/README.md).

## Primary risks and mitigations

| Risk | Evidence/impact | Required mitigation |
| --- | --- | --- |
| Big-bang Sprint 1 cutover | Owner accepts replacing old services/data, but scope is broad | contract freeze first; local end-to-end gate; staged production rollout; old deployment retained until smoke passes |
| Gateway becomes business orchestrator | It sees all commands/events | gateway only maps public transport to subjects and caches projections; job truth stays in DNA DB |
| Duplicate effects | JetStream delivery is at-least-once | inbox unique keys, transactional outbox, ack after commit, deterministic `jobId:stage` message ID |
| Redis mistaken for durable storage | Redis is required for scale | cache-aside/fallback policy; jobs/worlds remain PostgreSQL; NATS remains the only queue |
| Sleeping workers | Render Free wakes only on HTTP/WebSocket | use paid Background Worker or another always-on host; no HTTP wake hack |
| Query unavailable during service outage | Core NATS query requires a responder | short timeout, stable 503, Redis safe-cache fallback where allowed, durable DB unchanged |
| Canonical DNA becomes family-specific | Existing DNA models embed planets/landmarks | freeze neutral schema; family mappings and fixtures prove no render entities leak into DNA |
| Sensitive cache/message data | Raw questionnaire is personal | raw input stays in DNA DB; family commands carry validated DNA snapshot; public Redis caches use safe projections |
| Old docs mistaken for target | Current source docs accurately describe reverse proxy | visible current-vs-target banners and re-baseline after cutover |
| Service count/cost | Three always-on consumers require compute | cost is explicit; consolidate hosting only as a documented temporary deployment compromise, not a domain merge |

## Architecture fitness checks

CI and deployed smoke must eventually prove:

- a generation HTTP handler contains no provider call and returns after NATS
  `PubAck`;
- `dna-service` is the only module importing provider adapters;
- Universe/Nature build the same fixture deterministically after restart;
- duplicate delivery creates one logical result;
- Redis loss does not lose or corrupt a job/world;
- two gateway instances enforce the documented shared rate limit;
- direct public access exists only for web/gateway;
- each service credential is denied outside its allowed NATS subjects;
- no service can connect to another service's database;
- a fresh environment starts from root `docker-compose-local.yml` and the three version-one
  migrations without manual hidden steps.
