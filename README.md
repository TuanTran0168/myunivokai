# Myunivokai

Myunivokai turns a short personal profile into a deterministic 3D portrait.
The platform currently has two independent Go world services behind one Go
API Gateway:

- `universe-service`: Personality DNA with planets and a solar-system config;
- `nature-service`: Nature DNA with landmarks and a forest config;
- `api-gateway`: the single public edge, family routing, CORS, rate limiting,
  request verification, timeouts, circuit breaking, and public-share caching.

Both world services follow the same pipeline: input -> AI-generated semantic
DNA -> validated seeded builder -> PostgreSQL world/variants/share. Every 3D
number comes from a deterministic seed, and regenerating a variant makes no AI
call.

## Live and deploy status

| Component | Location |
| --- | --- |
| Existing web client | <https://myunivokai.vercel.app> |
| Render web client | Declared as `myunivokai-web` in `render.yaml`; URL is assigned on deploy |
| Existing universe API | <https://myunivokai.onrender.com> |
| Existing universe liveness | <https://myunivokai.onrender.com/api/v1/healthz> |
| API Gateway | Declared as `myunivokai-gateway` in `render.yaml`; URL is assigned on deploy |
| Nature API | Declared as `myunivokai-nature` in `render.yaml` |

Swagger belongs to each domain service and is mounted only outside production:

- universe: <http://localhost:8080/swagger/index.html>
- nature: <http://localhost:8081/swagger/index.html>

Render free services can sleep after inactivity, so the first request may need
about a minute to wake each service. The gateway's `/api/v1/statusz` checks both
upstreams concurrently and reports 503 until both are ready.

## Public API routing

The gateway does not parse or transform business payloads. It selects the
service from the public prefix and rewrites only the path:

| Public gateway route | Upstream route |
| --- | --- |
| `/api/universe/*` | `universe-service /api/v1/*` |
| `/api/nature/*` | `nature-service /api/v1/*` |
| `/api/v1/healthz` | Gateway liveness |
| `/api/v1/statusz` | Aggregated upstream readiness |

Examples:

```txt
POST /api/universe/worlds -> universe-service POST /api/v1/worlds
POST /api/nature/worlds   -> nature-service POST /api/v1/worlds
GET  /api/nature/share/worlds/{slug}
```

The frontend ships a **Universe/Forest family picker** and renders both scene
families from one source (`WorldFamily`). It receives only
`NEXT_PUBLIC_GATEWAY_BASE_URL=https://<gateway-host>`; its gateway helper adds
the family prefix. The peer-service hosts are never exposed to frontend
configuration.

## Security boundary

The gateway owns exact-origin CORS and one per-client token bucket shared by
both services. It also validates request IDs, limits bodies to 64 KiB, sanitizes
forwarding headers, applies security response headers, and overwrites any
client-supplied `X-Gateway-Key`.

The free Render upstreams still have public hostnames, so readiness and every
business route require `GATEWAY_SHARED_SECRET`. Render generates one 256-bit
value in the `myunivokai-gateway-secrets` environment group and links it to all
three services. Root and `/api/v1/healthz` stay public for platform liveness
checks. This is service-to-service authentication, not user authentication;
the repository still has no auth-service or user identity contract.

## Tech stack

### Backend

- Go 1.25, chi, `httputil.ReverseProxy`, zerolog;
- PostgreSQL via pgxpool and goose migrations in each world service;
- Gemini/OpenAI/mock provider abstraction in universe-service; mock provider
  currently wired in nature-service;
- Swagger in the two domain services;
- per-upstream gateway timeouts and circuit breakers; bounded in-memory cache
  only for successful public share responses.

### Frontend

- Next.js 14, React 18, TypeScript, Tailwind;
- React Three Fiber, drei, and postprocessing;
- vitest unit tests.

### Platforms

| Layer | Platform |
| --- | --- |
| Web client + gateway + two APIs | Render Docker services from `render.yaml` |
| Two logical databases | Neon PostgreSQL; pooled runtime URLs and direct migration URLs |
| CI | GitHub Actions for all three Go modules plus frontend checks |

## Repository layout

```txt
services/api-gateway        Public edge and routing to both world services
services/universe-service   Universe DNA, solar-system builder, own store
services/nature-service     Nature DNA, forest builder, own store
clients/web-client          Next.js + React Three Fiber web client
contracts                   Scene JSON schemas and shared contracts
notes                       Internal architecture, conventions, and roadmaps
```

## Run locally

### Full Docker stack

From the repository root, one command builds and starts both PostgreSQL
databases, both migration jobs, Universe, Nature, the API Gateway, and the web
client:

```bash
docker compose -f docker-compose-local.yml up --build
```

In VS Code, `Ctrl+Shift+B` runs the default task
`Myunivokai: Start full local stack`. The equivalent Make target is
`make local-up` on systems with Make installed. The VS Code task and direct
Docker command do not require Make.

| Local component | URL |
| --- | --- |
| Web client | <http://localhost:3000> |
| API Gateway | <http://localhost:8082> |
| Gateway health | <http://localhost:8082/api/v1/healthz> |
| Gateway upstream status | <http://localhost:8082/api/v1/statusz> |
| Universe Swagger | <http://localhost:8080/swagger/index.html> |
| Nature Swagger | <http://localhost:8081/swagger/index.html> |

The full stack builds the web client with the single
`NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:8082` origin. The client derives
both `/api/universe` and `/api/nature`; it has no direct peer URL. The stack also
gives the gateway and both upstreams the same development-only gateway key, so
browser business requests follow the real gateway boundary. PostgreSQL data
remains in named Docker volumes after stopping the stack.

Stop and remove the stack containers and network without deleting database
volumes:

```bash
docker compose -f docker-compose-local.yml down
```

The Make wrappers are `make local-up`, `make local-up-detached`,
`make local-logs`, `make local-status`, and `make local-down`. Host ports can be
overridden with `WEB_CLIENT_PORT`, `API_GATEWAY_PORT`, `UNIVERSE_API_PORT`,
`NATURE_API_PORT`, `UNIVERSE_DATABASE_PORT`, and `NATURE_DATABASE_PORT` before
running Compose.

### Run components separately

Each world service defaults to the mock provider and can use an in-memory store
when `DATABASE_URL` is empty:

```bash
cd services/universe-service
MYUNIVOKAI_ENV_FILE=.env.example go run ./cmd/api

cd services/nature-service
MYUNIVOKAI_ENV_FILE=.env.example go run ./cmd/api
```

On PowerShell, set the env variable with
`$env:MYUNIVOKAI_ENV_FILE = ".env.example"` before `go run`. The services
listen on ports 8080 and 8081. Start the gateway after both:

```bash
cd services/api-gateway
go run ./cmd/gateway
```

The gateway listens on port 8082. Local `.env.local` files leave the shared
credential empty so direct service and existing frontend development continue
to work. Set one identical non-empty value in all three processes when testing
gateway-only enforcement.

Local PostgreSQL stacks remain service-owned:

```bash
cd services/universe-service
docker compose -f docker-compose-local.yml up --build

cd services/nature-service
docker compose -f docker-compose-local.yml up --build
```

With both APIs running on host ports 8080/8081, the gateway can run in Docker:

```bash
cd services/api-gateway
docker compose -f docker-compose-local.yml up --build
```

## Tests and checks

Run the full gate in every Go module:

```bash
go mod verify
go vet ./...
go test ./...
go build ./...
```

Frontend gate:

```bash
cd clients/web-client
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

Backend tests use mock AI providers and never call a real AI API.

## Production deployment

**Full step-by-step runbook: [notes/ops/render-deployment.md](notes/ops/render-deployment.md)**
(Neon two-database setup, four-service Blueprint sync, every env value, and
rollout smoke tests). Summary below.

`render.yaml` manages `myunivokai-web`, `myunivokai-gateway`,
`myunivokai-api`, and `myunivokai-nature`. During initial Blueprint creation,
Render prompts for every `sync: false` value. Before syncing an existing
Blueprint, add the new web client's `NEXT_PUBLIC_GATEWAY_BASE_URL` and the
gateway's `API_ALLOWED_ORIGINS`, `UNIVERSE_SERVICE_URL`, and
`NATURE_SERVICE_URL` in the dashboard. Upstream URLs must be their public HTTPS
Render URLs on the free plan.

The shared environment group provides `GATEWAY_SHARED_SECRET` to all three.
Both world services fail production startup if that value is missing or shorter
than 32 characters. Their database URLs remain separate, and their entrypoints
run migrations against each service's direct Neon URL before API startup.

After all four services are configured:

1. set the web client's `NEXT_PUBLIC_GATEWAY_BASE_URL` to the gateway origin
   and set gateway CORS to the web-client origin;
2. verify gateway `/api/v1/healthz` and `/api/v1/statusz`;
3. create and read one universe world through `/api/universe`;
4. create and read one nature world through `/api/nature`;
5. confirm direct upstream business routes return 401 without the gateway key;
6. verify both families from the deployed web client.

## Documentation

- `notes/README.md`: internal documentation index;
- `notes/be/source-overview.md`: backend source and gateway request flow;
- `notes/fe/source-overview.md`: frontend source, the Universe/Forest family picker;
- `notes/fe/forest-render-mechanism.md`: how the forest scene is drawn + the asset/Sketchfab constraint;
- `notes/vision/api-gateway.md`: implemented gateway design and operations;
- `notes/vision/frontend-gateway-consolidation.md`: the one-gateway-origin frontend contract;
- `notes/ops/render-deployment.md`: step-by-step Render deploy runbook;
- `notes/vision/versions/v1-2026-07-22/deployment.md`: current approved deployment architecture/rationale;
- `notes/vision/nature-service-plan.md`: nature-service roadmap and decision log;
- `notes/user-stories/implemented-capabilities.md`: source-backed current product stories;
- `notes/user-stories/engineering-backlog.md`: prioritized BE/FE/repo tasks with Given/When/Then acceptance;
- `AGENTS.md`: repository rules for coding agents.

Planet textures come from Solar System Scope (CC BY 4.0); attribution lives in
`clients/web-client/public/textures/solar-system/ATTRIBUTION.md`.
