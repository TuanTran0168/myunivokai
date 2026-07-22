# My Unique Ok (AI)

Myunivokai is the technical repository name for **My Unique Ok (AI)**, an
AI-powered personal 3D universe generator. A visitor describes themselves once;
the platform creates canonical ProfileDNA and composes either a Universe or a
Nature world without exposing AI, databases, NATS, Redis, or domain services to
the browser.

## Architecture

```text
Browser (apps/myunivokai-web)
  -> HTTP
API Gateway
  -> JetStream command / Core NATS request-reply
DNA Service -> Universe Service or Nature Service
  -> family-owned PostgreSQL database

API Gateway -> Redis (distributed rate limit + bounded cache only)
```

- `services/api-gateway`: the only public backend; validates input, returns
  `202 + jobId`, polls jobs through NATS, and owns Redis edge policy.
- `services/dna-service`: raw profile input, root generation jobs, AI provider
  abstraction, immutable ProfileDNA versions, inbox/outbox.
- `services/universe-service`: deterministic solar-system worlds and variants.
- `services/nature-service`: deterministic forest worlds and variants.
- `contracts`: public OpenAPI, JSON Schemas, NATS fixtures, and shared Go types.
- `infra`: shared local PostgreSQL, JetStream NATS, Redis, ACL, and bootstrap.

Universe and Nature intentionally keep the `-service` suffix and are deployed
as Render Background Workers named `myunivokai-universe` and
`myunivokai-nature`; `worker` is their runtime type, not part of their names.

There is no auth service in V1. Browsers cannot call domain services because
those processes expose no HTTP server or host port. NATS credentials and
subject ACLs enforce internal boundaries.

## Run locally

Requirements: Docker Desktop with Compose 2.20+.

```powershell
docker compose --env-file .env.local -f docker-compose-local.yml config
docker compose --env-file .env.local -f docker-compose-local.yml up --build
```

Public endpoints:

| Component | URL |
| --- | --- |
| Web | <http://localhost:3000> |
| Gateway | <http://localhost:8080> |
| Liveness | <http://localhost:8080/api/v1/healthz> |
| Readiness | <http://localhost:8080/api/v1/readyz> |
| NATS monitor | <http://localhost:8222> |

The tracked `.env.local` values are local-only credentials. Never replace them
with managed or production secrets.

Shared infrastructure can be started separately, followed by one component:

```powershell
docker compose --env-file infra/.env.local -f infra/docker-compose-local.yml up -d
docker compose --env-file .env.local -f services/universe-service/docker-compose-local.yml up --build
```

Component Compose files share the named backend network and expect `infra` to
already be running when used outside the root aggregator.

## Quality gates

```powershell
cd contracts/go; go test ./...
cd ../../services/api-gateway; go test ./...; go vet ./...; go build ./...
cd ../dna-service; go test ./...; go vet ./...; go build ./...
cd ../universe-service; go test ./...; go vet ./...; go build ./...
cd ../nature-service; go test ./...; go vet ./...; go build ./...
cd ../../apps/myunivokai-web; npm run typecheck; npm run lint; npm test; npm run build
```

## Contracts and operations

- Current architecture: [Vision V1](notes/vision/versions/v1-2026-07-22/README.md)
- Sprint 1 migration: [Sprint 01](notes/sprints/sprint-01-2026-07-22/README.md)
- Local environment: [local-environment.md](notes/sprints/sprint-01-2026-07-22/local-environment.md)
- Render runbook: [deployment-guide.md](notes/sprints/sprint-01-2026-07-22/deployment-guide.md)
- API contract: [contracts/openapi.yaml](contracts/openapi.yaml)
- Internal docs index: [notes/README.md](notes/README.md)

Production provisioning and deployment require operator-supplied managed NATS,
Redis, Neon, and Render credentials. `render.yaml` defines the fleet but does
not create or delete managed databases.
