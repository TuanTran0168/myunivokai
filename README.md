# Myunivokai

Myunivokai is an AI-powered personal 3D universe generator. A visitor describes
themselves once; the platform creates canonical ProfileDNA and composes either
a Universe (Solar System) or a Nature (Forest) world without exposing AI, databases,
NATS, Redis, or domain services directly to the browser.

## Architecture

```mermaid
flowchart TB
  %% Class Definitions & Layer Colors
  classDef clientStyle fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e40af;
  classDef edgeStyle fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#166534;
  classDef infraStyle fill:#fffbe6,stroke:#d97706,stroke-width:2px,color:#92400e;
  classDef domainStyle fill:#faf5ff,stroke:#9333ea,stroke-width:2px,color:#6b21a8;
  classDef aiStyle fill:#fdf2f8,stroke:#db2777,stroke-width:2px,color:#9d174d;
  classDef dbStyle fill:#f0f9ff,stroke:#0284c7,stroke-width:2px,color:#075985;

  subgraph clientLayer ["Layer 1 - Client"]
    browser["<b>Browser</b><br/>User Interface"]:::clientStyle
    web["<b>Myunivokai Web</b><br/><i>Next.js + React Three Fiber</i>"]:::clientStyle
    browser --> web
  end

  subgraph edgeLayer ["Layer 2 - Edge"]
    gateway["<b>API Gateway</b><br/><i>Only Public Backend (HTTP :8080)</i>"]:::edgeStyle
  end

  subgraph infrastructureLayer ["Layer 3 - Shared Infrastructure"]
    redis[("<b>Redis</b><br/>Distributed Rate Limit & Cache")]:::infraStyle
    nats["<b>NATS</b><br/>JetStream Commands & Core NATS Queries"]:::infraStyle
  end

  subgraph domainLayer ["Layer 4 - Domain Services"]
    dna["<b>DNA Service</b><br/>AI Orchestration & Root Jobs"]:::domainStyle
    universe["<b>Universe Service</b><br/>Solar System Composition"]:::domainStyle
    nature["<b>Nature Service</b><br/>Forest Composition"]:::domainStyle
  end

  subgraph integrationLayer ["Layer 5 - AI Integration"]
    providers["<b>AI Providers</b><br/><code>ai.Provider</code> (Mock / Gemini / OpenAI)"]:::aiStyle
  end

  subgraph persistenceLayer ["Layer 6 - Service-Owned Persistence"]
    dnaDatabase[("<b>PostgreSQL</b><br/><code>myunivokai_dna</code>")]:::dbStyle
    universeDatabase[("<b>PostgreSQL</b><br/><code>myunivokai_universe</code>")]:::dbStyle
    natureDatabase[("<b>PostgreSQL</b><br/><code>myunivokai_nature</code>")]:::dbStyle
  end

  web -->|"HTTPS"| gateway
  gateway <-->|"Rate Limit & Cache"| redis
  gateway <-->|"Commands, Queries & Events"| nats
  nats <-->|"Generate DNA & Track Root Jobs"| dna
  nats <-->|"Compose & Manage Universe Worlds"| universe
  nats <-->|"Compose & Manage Nature Worlds"| nature
  dna -->|"ai.Provider Interface"| providers
  dna -->|"Owns Schema"| dnaDatabase
  universe -->|"Owns Schema"| universeDatabase
  nature -->|"Owns Schema"| natureDatabase
```

The diagram is an ownership and communication tree, not a request sequence.
Domain services both consume and publish messages through NATS. Redis is edge
state owned by the gateway; it is not a job queue. Each service is the sole
owner of its PostgreSQL database.

- `services/api-gateway`: the only public backend; validates input, returns
  `202 + jobId`, polls jobs through NATS, and owns Redis edge policy.
- `services/dna-service`: raw profile input, root generation jobs, AI provider
  abstraction, immutable ProfileDNA versions, inbox/outbox.
- `services/universe-service`: deterministic solar-system worlds and variants.
- `services/nature-service`: deterministic forest worlds and variants.
- `contracts`: public OpenAPI, JSON Schemas, NATS fixtures, and shared Go types.
- `infra`: shared local PostgreSQL, JetStream NATS, Redis, ACL, and bootstrap.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend / Web** | Next.js 14, React 18, React Three Fiber (R3F), Three.js, Tailwind CSS, TypeScript |
| **Backend Services** | Go, Chi Router, `pgxpool`, zerolog |
| **Messaging & Events** | NATS (JetStream WorkQueue for Commands/Events + Core NATS Request-Reply for Queries) |
| **Edge & Caching** | Redis (Distributed rate limiting & cache-aside state) |
| **Persistence** | PostgreSQL on Neon (3 isolated databases: `myunivokai_dna`, `myunivokai_universe`, `myunivokai_nature`) |
| **AI Integration** | Provider abstraction (`ai.Provider`) supporting Gemini, OpenAI, and deterministic Mock provider |
| **DevOps & Containers** | Docker, Docker Compose, Render (Web Service & Background Workers) |

## Run locally

Requirements: Docker Desktop with Compose 2.20+.

```powershell
docker compose -f docker-compose-local.yml config
docker compose -f docker-compose-local.yml up --build
```

Public endpoints:

| Component | URL |
| --- | --- |
| Web | <http://localhost:3000> |
| Gateway | <http://localhost:8080> |
| Liveness | <http://localhost:8080/api/v1/healthz> |
| Readiness | <http://localhost:8080/api/v1/readyz> |
| PostgreSQL diagnostics | `localhost:15432` |
| NATS client diagnostics | `nats://localhost:14222` |
| NATS monitor | <http://localhost:18222> |
| Redis diagnostics | `localhost:16379` |

The tracked `.env.local` values are local-only credentials. Never replace them
with managed or production secrets.

Shared infrastructure can be started separately, followed by one component:

```powershell
docker compose --env-file infra/.env.local -f infra/docker-compose-local.yml up -d
docker compose --env-file services/universe-service/.env.local `
  -f services/universe-service/docker-compose-local.yml up --build
```

Component Compose files share the named backend network and expect `infra` to
already be running when used outside the root aggregator. Their `.env.local`
files are also attached directly to their runtime containers; `--env-file`
remains useful for standalone Compose interpolation and explicit overrides.

## Quality gates

```powershell
cd contracts/go; go test ./...
cd ../../services/api-gateway; go test ./...; go vet ./...; go build ./...
cd ../dna-service; go test ./...; go vet ./...; go build ./...
cd ../universe-service; go test ./...; go vet ./...; go build ./...
cd ../nature-service; go test ./...; go vet ./...; go build ./...
cd ../../apps/myunivokai-web; npm run typecheck; npm run lint; npm test; npm run build
npm audit --omit=dev --audit-level=high
```

## Contracts and operations

- Current architecture: [Vision V1](notes/vision/versions/v1-2026-07-22/README.md)
- Sprint 1 migration: [Sprint 01](notes/sprints/sprint-01-2026-07-22/README.md)
- Local environment: [local-environment.md](notes/sprints/sprint-01-2026-07-22/local-environment.md)
- Render runbook: [deployment-guide.md](notes/sprints/sprint-01-2026-07-22/deployment-guide.md)
- API contract: [contracts/openapi.yaml](contracts/openapi.yaml)
- Internal docs index: [notes/README.md](notes/README.md)
