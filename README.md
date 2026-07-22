# Myunivokai

Myunivokai is an AI-powered personal 3D universe generator. A visitor describes
themselves once; the platform creates canonical ProfileDNA and composes either
a Universe or a Nature world without exposing AI, databases, NATS, Redis, or
domain services to the browser.

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
    web["<b>Myunivokai Web</b><br/><code>apps/myunivokai-web</code><br/><i>Next.js 14 + React Three Fiber</i>"]:::clientStyle
    browser --> web
  end

  subgraph edgeLayer ["Layer 2 - Edge"]
    gateway["<b>API Gateway</b><br/><code>services/api-gateway</code><br/><i>Only Public Backend (HTTP :8080)</i>"]:::edgeStyle
  end

  subgraph infrastructureLayer ["Layer 3 - Shared infrastructure"]
    redis[("<b>Redis</b><br/>distributed rate limit<br/>bounded cache")]:::infraStyle
    nats["<b>NATS</b><br/>JetStream commands and events<br/>Core NATS request-reply"]:::infraStyle
  end

  subgraph domainLayer ["Layer 4 - Domain services"]
    dna["<b>DNA Service</b><br/><code>services/dna-service</code><br/>AI orchestration and root jobs"]:::domainStyle
    universe["<b>Universe Service</b><br/><code>services/universe-service</code><br/>solar-system composition"]:::domainStyle
    nature["<b>Nature Service</b><br/><code>services/nature-service</code><br/>forest composition"]:::domainStyle
  end

  subgraph integrationLayer ["Layer 5 - AI integration"]
    providers["<b>AI Providers</b><br/><code>ai.Provider</code> Interface<br/>mock / Gemini / OpenAI"]:::aiStyle
  end

  subgraph persistenceLayer ["Layer 6 - Service-owned persistence"]
    dnaDatabase[("<b>PostgreSQL</b><br/><code>myunivokai_dna</code>")]:::dbStyle
    universeDatabase[("<b>PostgreSQL</b><br/><code>myunivokai_universe</code>")]:::dbStyle
    natureDatabase[("<b>PostgreSQL</b><br/><code>myunivokai_nature</code>")]:::dbStyle
  end

  web -->|"HTTPS"| gateway
  gateway <-->|"rate limit and cache"| redis
  gateway <-->|"commands, queries, and mutations"| nats
  nats <-->|"generate DNA and track root jobs"| dna
  nats <-->|"compose and manage universe worlds"| universe
  nats <-->|"compose and manage nature worlds"| nature
  dna -->|"ai.Provider interface"| providers
  dna -->|"owns"| dnaDatabase
  universe -->|"owns"| universeDatabase
  nature -->|"owns"| natureDatabase
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

Production provisioning and deployment require operator-supplied managed NATS,
Redis, Neon, and Render credentials. `render.yaml` defines the fleet but does
not create or delete managed databases. Production promotion is currently
blocked by Sprint story
[S1-SECURITY-001](notes/sprints/sprint-01-2026-07-22/user-stories.md#s1-security-001--remove-vulnerable-frontend-runtime-dependencies):
the existing Next.js 14 runtime must be upgraded and browser-regression tested
before deployment.
