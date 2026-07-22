# Sprint 01 local Docker environment contract

> **Document status:** Implemented configuration; real container smoke pending
> **Sprint starts:** 2026-07-22
> **Last source review:** 2026-07-22

This contract preserves the repository's explicit local naming style while
separating shared infrastructure from component-owned development containers.

## 1. Decisions

- Keep root filename `docker-compose-local.yml`.
- Use `.env.local` as the active local environment filename.
- Keep a `docker-compose-local.yml` inside every app/service for standalone
  development.
- Put only shared dependencies in `infra/docker-compose-local.yml`.
- Keep domain folder suffixes: `dna-service`, `universe-service`,
  `nature-service`, and future `city-service`.
- Rename `clients/web-client` to `apps/myunivokai-web` during Sprint 1.
- Every deployable owns `Dockerfile.local` and `Dockerfile.prod`.
- Production Dockerfiles use exactly two stages: builder and minimal runtime.
- Production credentials never live in any `.env.local`.

## 2. Target tree

```txt
docker-compose-local.yml          # integrated stack aggregator
.env.local                        # integrated local values

infra/
  docker-compose-local.yml        # shared dependencies only
  .env.local                      # standalone infra values
  nats/
    nats-server.conf
  redis/
    redis.conf
  postgres/
    init-databases.sql

apps/
  myunivokai-web/
    docker-compose-local.yml
    .env.local
    Dockerfile.local
    Dockerfile.prod

services/
  api-gateway/
    docker-compose-local.yml
    .env.local
    Dockerfile.local
    Dockerfile.prod
  dna-service/
    docker-compose-local.yml
    .env.local
    Dockerfile.local
    Dockerfile.prod
    migrations/
  universe-service/
    docker-compose-local.yml
    .env.local
    Dockerfile.local
    Dockerfile.prod
    migrations/
  nature-service/
    docker-compose-local.yml
    .env.local
    Dockerfile.local
    Dockerfile.prod
    migrations/
```

## 3. Compose ownership

### Root aggregator

Root `docker-compose-local.yml` contains no duplicated service definition. It
uses top-level `include`:

```yaml
name: myunivokai-local

include:
  - ./infra/docker-compose-local.yml
  - ./services/api-gateway/docker-compose-local.yml
  - ./services/dna-service/docker-compose-local.yml
  - ./services/universe-service/docker-compose-local.yml
  - ./services/nature-service/docker-compose-local.yml
  - ./apps/myunivokai-web/docker-compose-local.yml
```

`include` requires Docker Compose 2.20 or later. Unlike combining unrelated
files with multiple `-f` flags, included files resolve build contexts, bind
mounts and config paths relative to their own folder. The implementation must
run `docker compose config` in CI to detect name/resource conflicts.

Reference: [Docker Compose include](https://docs.docker.com/reference/compose-file/include/).

### Shared infra

`infra/docker-compose-local.yml` owns only:

```txt
postgres
postgres-init
nats
nats-bootstrap
redis
```

Responsibilities:

- one PostgreSQL server with three logical databases and least-privilege roles;
- JetStream-enabled NATS, local users/subject permissions, streams and durable
  consumer bootstrap;
- Redis persistence/health for local rate-limit and cache tests;
- shared backend network and named data volumes.

It does not build or start application/domain code.

### Component Compose files

Each component owns its container definition, build context, environment,
source mounts, health check and service-specific dependency declarations.

| Compose file | Owned containers |
| --- | --- |
| `apps/myunivokai-web/docker-compose-local.yml` | `myunivokai-web` |
| `services/api-gateway/docker-compose-local.yml` | `api-gateway` |
| `services/dna-service/docker-compose-local.yml` | `dna-migrate`, `dna-service` |
| `services/universe-service/docker-compose-local.yml` | `universe-migrate`, `universe-service` |
| `services/nature-service/docker-compose-local.yml` | `nature-migrate`, `nature-service` |

Domain services expose no host HTTP business port after the NATS migration.
Migration jobs remain component-owned even though PostgreSQL is shared infra.

## 4. Local and production Dockerfiles

### `Dockerfile.local`

The local image optimizes developer feedback, not size:

- Go SDK or Node toolchain is present;
- dependencies are cached in dedicated layers/volumes;
- source is bind-mounted or synchronized;
- Go services use a pinned hot-reload/watch tool or Compose watch;
- Next.js runs its development server;
- readable build output and race/debug tooling may be enabled;
- local Compose selects only `Dockerfile.local`.

### `Dockerfile.prod`

Every production Dockerfile has exactly two stages:

```txt
builder -> runtime
```

Go production rules:

- builder downloads modules and produces stripped static service/migration
  binaries;
- runtime uses a minimal pinned base, non-root user and required CA
  certificates only;
- no Go compiler, module cache or source tree remains;
- Universe/Nature/DNA background processes expose no fake HTTP port.

Next.js production rules:

- builder performs `npm ci` and `npm run build` in one stage;
- runtime copies only `public`, standalone output and static output;
- runtime uses a non-root user and production environment;
- no development dependencies or source tree are copied.

Production configuration (`render.yaml`) references `Dockerfile.prod` only.
Local Compose references `Dockerfile.local` only. The current generic
`Dockerfile` and `Dockerfile.render` names are retired after equivalent smoke
tests pass.

## 5. Environment files

### Integrated root `.env.local`

Root `.env.local` is the source for a full local stack. It includes:

```dotenv
COMPOSE_PROJECT_NAME=myunivokai-local
APP_ENV=development

WEB_PORT=3000
GATEWAY_PORT=8080
POSTGRES_PORT=5432
NATS_CLIENT_PORT=4222
NATS_MONITOR_PORT=8222
REDIS_PORT=6379

POSTGRES_ADMIN_USER=myunivokai_admin
POSTGRES_ADMIN_PASSWORD=<local-only-value>

DNA_DATABASE_NAME=myunivokai_dna
DNA_DATABASE_USER=myunivokai_dna_app
DNA_DATABASE_PASSWORD=<local-only-value>

UNIVERSE_DATABASE_NAME=myunivokai_universe
UNIVERSE_DATABASE_USER=myunivokai_universe_app
UNIVERSE_DATABASE_PASSWORD=<local-only-value>

NATURE_DATABASE_NAME=myunivokai_nature
NATURE_DATABASE_USER=myunivokai_nature_app
NATURE_DATABASE_PASSWORD=<local-only-value>

NATS_URL=nats://nats:4222
NATS_STREAM_COMMANDS=MYUNIVOKAI_COMMANDS
NATS_STREAM_EVENTS=MYUNIVOKAI_EVENTS
NATS_GATEWAY_USERNAME=myunivokai_gateway
NATS_GATEWAY_PASSWORD=<local-only-value>
NATS_DNA_USERNAME=myunivokai_dna
NATS_DNA_PASSWORD=<local-only-value>
NATS_UNIVERSE_USERNAME=myunivokai_universe
NATS_UNIVERSE_PASSWORD=<local-only-value>
NATS_NATURE_USERNAME=myunivokai_nature
NATS_NATURE_PASSWORD=<local-only-value>

REDIS_URL=redis://redis:6379/0
REDIS_PASSWORD=<local-only-value>
REDIS_KEY_PREFIX=myunivokai

RATE_LIMIT_REQUESTS_PER_SECOND=2
RATE_LIMIT_BURST=20
JOB_CACHE_TTL=30s
WORLD_CACHE_TTL=60s
SHARE_CACHE_TTL=60s

NATS_REQUEST_TIMEOUT=3s
NATS_QUERY_TIMEOUT=2500ms
NATS_ACK_WAIT=2m
NATS_MAX_DELIVER=5
SERVICE_SHUTDOWN_TIMEOUT=15s

AI_PROVIDER=mock
AI_FALLBACK_PROVIDER=mock
AI_ENABLE_FALLBACK=true
AI_TIMEOUT=35s
GEMINI_API_KEY=
OPENAI_API_KEY=

NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:8080
```

### Component `.env.local`

Each component keeps a minimal `.env.local` for running only that component.
It contains only variables owned/consumed by that component. Integrated startup
must ensure root values override or match component defaults; Sprint 1 adds a
configuration consistency check so credentials/ports cannot drift silently.

Policy:

- local/mock-only values may be committed if they grant no access outside the
  developer machine/Compose network;
- real AI keys, managed NATS credentials, Redis URLs and Neon URLs are always
  ignored and supplied out of band;
- production never loads `.env.local`;
- frontend `.env.local` contains only `NEXT_PUBLIC_*` values intended for the
  browser.

Do not reintroduce target-runtime `UNIVERSE_SERVICE_URL`,
`NATURE_SERVICE_URL`, or `GATEWAY_SHARED_SECRET`.

## 6. Networks, volumes and ports

Networks:

```txt
edge     myunivokai-web, api-gateway
backend  api-gateway, dna-service, universe-service, nature-service,
         postgres, nats, redis
```

Named volumes:

```txt
myunivokai-postgres-data
myunivokai-nats-data
myunivokai-redis-data
```

Published developer ports:

| Port | Purpose |
| ---: | --- |
| 3000 | branded web app |
| 8080 | gateway HTTP API |
| 5432 | optional local PostgreSQL diagnostics |
| 4222 | optional local NATS CLI/client diagnostics |
| 8222 | local NATS monitoring |
| 6379 | optional local Redis diagnostics |

Database/NATS/Redis diagnostic ports bind to localhost only where Compose
supports the host binding syntax. Domain services publish no host port.

## 7. Startup order

1. PostgreSQL, NATS and Redis pass health checks.
2. `postgres-init` creates databases/roles idempotently.
3. `nats-bootstrap` creates streams and consumers idempotently.
4. DNA/Universe/Nature migrations complete.
5. Domain consumers/responders connect and become ready.
6. Gateway verifies NATS and Redis readiness.
7. `myunivokai-web` starts against the single gateway origin.

## 8. Developer commands

Integrated stack:

```powershell
docker compose --env-file .env.local -f docker-compose-local.yml up --build
docker compose --env-file .env.local -f docker-compose-local.yml ps
docker compose --env-file .env.local -f docker-compose-local.yml down
```

Standalone component example:

```powershell
docker compose --env-file infra/.env.local `
  -f infra/docker-compose-local.yml up -d
docker compose --env-file services/universe-service/.env.local `
  -f services/universe-service/docker-compose-local.yml up --build
```

The first command owns shared dependencies. Component Compose files remain
valid independently and join the same named network, but do not duplicate or
implicitly create NATS, Redis, or PostgreSQL.

Volume reset is destructive and deliberately separate. Before running a reset,
resolve and confirm the Compose project is exactly `myunivokai-local`; state
that local PostgreSQL, JetStream and Redis data will be removed.

## 9. Acceptance

- [x] Docker Compose 2.20+ is validated before using `include`.
- [x] `docker compose ... config` resolves every included file without
      duplicate resource names or wrong relative paths.
- [ ] Full stack and each component Compose path are documented and tested.
- [x] Local images use `Dockerfile.local`; production uses `Dockerfile.prod`.
- [x] Every production Dockerfile contains exactly builder/runtime stages.
- [ ] Production image inspection finds no compiler, package cache, source tree
      or real secret.
- [ ] Hot reload/watch works for Go and Next.js local development.
- [ ] Fresh local volumes initialize databases, NATS and Redis automatically.
- [ ] Restart preserves pending JetStream work and local data volumes.
- [ ] Domain services are unreachable through host HTTP.
- [ ] No production credential exists in a tracked `.env.local`.
