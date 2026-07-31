# Sprint 01 user stories — complete platform migration

> **Document status:** Active sprint acceptance record
> **Sprint starts:** 2026-07-22
> **Last source review:** 2026-07-23

User stories live with the sprint that commits to delivering them. The central
`notes/user-stories` folder is now an index and cross-sprint product backlog;
this file owns Sprint 1 status and evidence.

Status meanings: `Implemented` has source and automated evidence; `Verified`
also has the named real environment evidence; `Prepared` is operator-ready but
cannot be verified without external credentials/runtime.

## S1-CONTRACT-001 — Stable public and event contracts

Status: Implemented

As a service developer, I want versioned contracts so independently deployed
services cannot silently disagree.

Given any V1 NATS command/event/query, when it is encoded, then its top level is
only `jobId`, `timestamp`, and typed `data`; family/profile/world fields stay in
`data`. The browser contract describes `202`, job polling, world lifecycle, and
privacy-safe share routes.

Evidence:

- `contracts/go/contracts.go` and contract tests;
- `contracts/schemas/message-envelope.schema.json` and ProfileDNA schema;
- `contracts/fixtures/` fixed command examples;
- `contracts/openapi.yaml`.

## S1-LOCAL-001 — One local target stack

Status: Verified on local Docker Engine

As a developer, I want one local command so service boundaries and dependencies
match production before deployment.

Given Docker Compose 2.20+, when the root config is resolved, then it includes
shared `infra` plus every deployable, three canonical databases, JetStream,
Redis, component migrations, local/prod Dockerfiles, named networks/volumes,
and no domain HTTP port.

Evidence:

- root `.env.local` and `docker-compose-local.yaml`;
- `infra/` PostgreSQL/NATS/Redis configuration;
- component Compose and exactly two-stage production Dockerfiles;
- `docker compose ... config --quiet` passes;
- Docker Engine 27.4.0 full-stack health and both family lifecycle smokes pass,
  as recorded in `local-environment.md`.

The local verification created all three fresh databases, both JetStream
streams, Redis persistence, and completed one Universe and one Nature job
through the public Gateway. Managed deployment remains separate acceptance.

## S1-EDGE-001 — Gateway uses NATS and Redis

Status: Implemented

As a visitor, I want durable fast acceptance and one scaled edge policy so AI
latency does not hold an HTTP connection and multiple gateways behave alike.

Given valid input, when the Gateway receives create, then it waits for a
JetStream PubAck and returns `202 + jobId`. Reads and mutations use bounded Core
NATS request-reply. Redis supplies an atomic distributed token bucket and
bounded cache; Redis failure uses cache miss/local limiter fallback and fails
readiness without becoming a second queue.

Evidence: `services/api-gateway/internal/{broker,edge,handlers,middleware}` and
Gateway tests/vet/build.

Universe and Nature routes use separate handlers with constructor-fixed NATS
subjects; DNA job polling has its own handler. Shared request/reply and cache
rules remain centralized in `RPCTransport`.

## S1-DNA-001 — Canonical DNA and root jobs

Status: Implemented

As a visitor, I want one family-neutral portrait so visual families consume the
same meaning instead of independently calling AI.

Given a generation command, when DNA Service handles it, then it validates and
persists raw input/root job, invokes only the `ai.Provider` abstraction, records
safe attempt metadata, stores immutable ProfileDNA, and transactionally queues
only the selected family. Completion/failure updates the durable job queried by
Gateway.

Evidence: `services/dna-service`, `myunivokai_dna` migration, provider/repair
tests, inbox/outbox, and module test/vet/build.

The mock provider preserves the original runtime variety: it randomly chooses
between multiple valid ProfileDNA presets per mood and randomizes facet energy.
Tests inject a deterministic random-index strategy rather than weakening the
runtime behavior.

Follow-up outside the current UI: requesting a second family from an existing
DNA version is still a V1 contract extension, not an exposed public route.

## S1-FAMILY-001 — Independent Universe and Nature services

Status: Implemented

As an operator, I want each family independently deployable so one family can
scale or fail without combining domain ownership.

Given one or more deliveries of a compose command, when the family consumes it,
then one logical world and completion outbox are created, existing deterministic
builders/variant behavior remain, and Core NATS returns existing public JSON
shapes. No family starts an HTTP API or owns provider logic.

Evidence: both family migrations, messaging runtimes, memory idempotency tests,
existing deterministic/golden tests, and module test/vet/build.

Each family has an explicit inbound NATS handler layer for compose and all Core
NATS query/mutation subjects. Runtime code owns subscription/ack/retry/outbox
mechanics; handlers validate the generic envelope and call narrow service
interfaces.

## S1-FE-001 — Reliable asynchronous generation

Status: Verified by automated frontend gates

As a visitor, I want visible progress and refresh recovery so an asynchronous
job does not look frozen.

Given `202 + jobId`, when generation is queued or processing, then the UI polls
with bounded backoff/two-minute deadline, displays progress, supports
AbortSignal cancellation when the view unmounts, stores pending state in
session storage, resumes after refresh, and navigates only after completion.

Evidence: `apps/myunivokai-web/src/lib/api.ts`, home/overlay integration, 84
passing tests, typecheck, lint, and production build.

## S1-DEPLOY-001 — Reproducible production fleet

Status: Deployed and reachable; lifecycle and failure evidence still pending

As an operator, I want a safe deploy/rollback sequence so configuration is not
mistaken for a successful cutover.

Given managed NATS/Redis, three Neon databases, and Render access, when the
operator applies `render.yaml` and the deployment guide, then Gateway is the
only public backend and DNA/Universe/Nature carry no `-worker` suffix.
Migrations run automatically at service start.

**Corrected 2026-07-29.** This story previously required "paid Background
Workers" and migrations as "pre-deploy commands". Neither matches the delivered
system, and the difference is a deliberate cost decision, not a defect:
`render.yaml` declares all four services as `type: web`, `plan: free`, and
[the production guide](../../ops/production-deployment-guide.md) records the
same. Free Render plans have no pre-deploy hook, so migrations run at startup
(guide §5, with the `outbox_messages` / prepared-statement failure and its fix
in §5.4). The three domain services also run a minimal `/healthz` HTTP server
purely so Render's port scan succeeds (§5.6) — they expose no business port.
Left as written, the acceptance could never be met by the system that exists.

Evidence recorded 2026-07-29T23:42Z at commit `653c845`, by direct request from
this workstation:

| Target | Check | Result |
| --- | --- | --- |
| `myunivokai.vercel.app` | `GET /` | 200 |
| `myunivokai-gateway.onrender.com` | `GET /api/v1/healthz` | 200 |
| `myunivokai-gateway.onrender.com` | `GET /api/v1/readyz` | 200, `{"nats":"ready","redis":"ready"}` |
| `myunivokai-dna.onrender.com` | `GET /healthz` | 200 |
| `myunivokai-universe.onrender.com` | `GET /healthz` | 200 |
| `myunivokai-nature.onrender.com` | `GET /healthz` | 200 |

The gateway readiness probe pings NATS and Redis with a 2s timeout
(`services/api-gateway/internal/handlers/health_handler.go`), so a 200 there is
positive proof that managed Synadia NATS and managed Upstash Redis are both
reachable from the deployed gateway — not merely that the process is running.

Still unproven, and deliberately left unchecked:

- public lifecycle smoke for both families (create → job → world → publish →
  share) against production;
- negative NATS ACL and least-privilege database tests;
- failure/retry smoke proving an accepted job is never silently lost;
- two Gateway instances sharing one Redis rate-limit policy;
- a tested rollback.

Reachability is not a lifecycle. Four healthy processes and a live Redis/NATS
connection say the fleet is up; they say nothing about whether a generation job
completes end to end. No external deployment or destructive legacy retirement
is automated.

## S1-SECURITY-001 — Remove vulnerable frontend runtime dependencies

Status: Required before production cutover

As an operator, I want the deployed web runtime free of known high-severity
dependency advisories so passing functional tests is not mistaken for
production readiness.

The 2026-07-23 source audit found that `next@14.2.35` has a high-severity
production advisory set. `npm audit --omit=dev` reports one high and one
moderate vulnerable package; its available remediation is a Next.js 16 major
upgrade. That upgrade also requires React/App Router compatibility work,
asynchronous dynamic route params, ESLint flat config, and browser regression
evidence. It is deliberately not hidden inside the NATS migration without that
verification.

Acceptance:

- upgrade to a supported patched Next.js/React combination;
- migrate lint and route APIs using the official upgrade guidance;
- `npm audit --omit=dev --audit-level=high` exits 0;
- all current frontend gates and both family browser lifecycle E2E tests pass;
- visual/interaction regression is approved before production traffic.
