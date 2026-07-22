# Myunivokai

Myunivokai is an AI-powered personal 3D universe generator. A visitor describes themselves once; the platform creates canonical ProfileDNA and composes interactive 3D worlds (Solar Systems or Nature Forests) using Next.js, Three.js, Go microservices, NATS JetStream, Redis, and Neon PostgreSQL.

## Architecture

```mermaid
flowchart TB
  %% Styling Tokens
  classDef client fill:#f0f7ff,stroke:#0284c7,stroke-width:2px,color:#0369a1;
  classDef edge fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#15803d;
  classDef infra fill:#fefce8,stroke:#ca8a04,stroke-width:2px,color:#854d0e;
  classDef domain fill:#faf5ff,stroke:#9333ea,stroke-width:2px,color:#6b21a8;
  classDef ai fill:#fdf2f8,stroke:#db2777,stroke-width:2px,color:#9d174d;
  classDef db fill:#eff6ff,stroke:#3b82f6,stroke-width:2px,color:#1d4ed8;

  subgraph Layer1 ["🌐 Client Layer"]
    web["<b>Myunivokai Web</b><br/><code>apps/myunivokai-web</code><br/><i>Next.js 14 + React Three Fiber</i>"]:::client
  end

  subgraph Layer2 ["⚡ Public Edge Gateway"]
    gateway["<b>API Gateway</b><br/><code>services/api-gateway</code><br/><i>(Only Public HTTP Port :8080)</i>"]:::edge
    redis[("<b>Redis Engine</b><br/>Rate Limiting & Cache-Aside")]:::infra
  end

  subgraph Layer3 ["🚀 Message Broker & Event Bus"]
    nats["<b>NATS Event Broker</b><br/>JetStream WorkQueue + Core NATS Request-Reply"]:::infra
  end

  subgraph Layer4 ["🧠 Domain Services (NATS Workers)"]
    dna["<b>DNA Service</b><br/><code>services/dna-service</code><br/><i>AI Orchestration & Root Jobs</i>"]:::domain
    universe["<b>Universe Service</b><br/><code>services/universe-service</code><br/><i>Solar System Builder</i>"]:::domain
    nature["<b>Nature Service</b><br/><code>services/nature-service</code><br/><i>Forest Scene Builder</i>"]:::domain
  end

  subgraph Layer5 ["🤖 AI Integration"]
    providers["<b>AI Provider Abstraction</b><br/><code>ai.Provider</code> (Mock / Gemini / OpenAI)"]:::ai
  end

  subgraph Layer6 ["🗄️ Service-Owned Data Layer"]
    dnaDb[("<b>myunivokai_dna</b><br/>PostgreSQL (Neon)")]:::db
    universeDb[("<b>myunivokai_universe</b><br/>PostgreSQL (Neon)")]:::db
    natureDb[("<b>myunivokai_nature</b><br/>PostgreSQL (Neon)")]:::db
  end

  %% Flow Connections
  web -->|"HTTPS REST API"| gateway
  gateway <-->|"Rate Limit & Cache"| redis
  gateway -->|"Pub Commands / Request-Reply"| nats

  nats <-->|"1. Generate DNA Command / Queries"| dna
  dna -->|"2. AI Generation"| providers
  dna -->|"3. Publish Family Compose Cmd"| nats

  nats <-->|"4a. Compose Universe Cmd / Queries"| universe
  nats <-->|"4b. Compose Nature Cmd / Queries"| nature

  universe -->|"5a. Event: Universe Completed/Failed"| nats
  nature -->|"5b. Event: Nature Completed/Failed"| nats

  dna -->|"Owns DB"| dnaDb
  universe -->|"Owns DB"| universeDb
  nature -->|"Owns DB"| natureDb
```

### Core Components

- `apps/myunivokai-web`: Next.js 3D web application built with React Three Fiber and Tailwind CSS.
- `services/api-gateway`: Single public edge entry point (`:8080`); handles REST API validation, Redis rate limiting/caching, and NATS message dispatching.
- `services/dna-service`: Manages raw user input, root generation jobs, AI provider abstraction (`ai.Provider`), and immutable ProfileDNA.
- `services/universe-service`: Seed-deterministic solar system scene generator and variant engine.
- `services/nature-service`: Seed-deterministic forest/nature scene generator and variant engine.
- `contracts`: OpenAPI specs, JSON schemas, NATS fixtures, and shared Go data types.
- `infra`: Local development environment configurations for PostgreSQL, NATS JetStream, and Redis.

## Run Locally

**Requirement**: Docker Desktop with Compose 2.20+.

```powershell
# Start complete local stack
docker compose -f docker-compose-local.yml up --build
```

### Public & Diagnostic Endpoints

| Component | URL / Endpoint |
| --- | --- |
| Web Application | <http://localhost:3000> |
| API Gateway | <http://localhost:8080> |
| Gateway Health Check | <http://localhost:8080/api/v1/healthz> |
| NATS Monitoring | <http://localhost:18222> |
| NATS Client | `nats://localhost:14222` |
| PostgreSQL Diagnostics | `localhost:15432` |
| Redis Diagnostics | `localhost:16379` |

## Quality Gates

Run quality verification across all modules:

```powershell
# Backend Verification
cd contracts/go; go test ./...
cd ../../services/api-gateway; go test ./...; go vet ./...; go build ./...
cd ../dna-service; go test ./...; go vet ./...; go build ./...
cd ../universe-service; go test ./...; go vet ./...; go build ./...
cd ../nature-service; go test ./...; go vet ./...; go build ./...

# Frontend Verification
cd ../../apps/myunivokai-web; npm run typecheck; npm run lint; npm test; npm run build
```

## Documentation & Contracts

- **Internal Docs Index**: [notes/README.md](notes/README.md)
- **Architecture Baseline**: [Vision V1](notes/vision/versions/v1-2026-07-22/README.md)
- **API Contract**: [contracts/openapi.yaml](contracts/openapi.yaml)
- **Render Deployment**: [notes/ops/render-deployment.md](notes/ops/render-deployment.md)
