# nature-service

The second Myunivokai world service: an AI-personalized **forest portrait**
instead of a solar system. Full peer of `services/universe-service` — same
mechanism (input → Nature DNA via the AI orchestrator, mock by default →
deterministic seeded builder → stored world with variants and share links),
only the DNA layer differs: **landmarks** (heart tree, still pond, standing
stone…) instead of planets.

The scene contract is `ForestSceneConfig` (`sceneType: "forest"`,
`schemaVersion: "1.0"`): four seasons with transitional blends ("giao mùa"),
weather (rain/sun rays/overcast/snow), wind over the tree canopy, ground
animals and bird flocks, autumn falling leaves and winter snow, plus one
clickable landmark per DNA landmark. Every visual number is drawn from
seed-derived PRNG streams inside named-constant bounds — same seed, same
forest, and regenerating a variant never calls AI.

Plan and roadmap: `notes/vision/nature-service-plan.md` (rounds N1–N5).
Rounds N1–N3 are code-complete: the whole pipeline, persistence (goose
migrations + postgres store), Render deploy files, the contract schema
(`contracts/scenes/forest-scene-config.schema.json`) and golden fixtures.
Without `DATABASE_URL` the service runs on an in-memory store (development
only — production start is refused, same guard as universe-service).

In production, clients call nature through `services/api-gateway` at
`/api/nature/*`. The direct `/api/v1/healthz` remains public for the Render
liveness probe; readiness and all business routes require the shared gateway
credential. Local standalone calls continue to work while
`GATEWAY_SHARED_SECRET` is empty.

## Database (zero extra cost)

nature-service owns its own **logical database inside the same Neon project**
as universe-service — creating a second database costs nothing and keeps the
production universe data completely out of this service's blast radius:

1. Neon dashboard → the existing project → Databases → create
   `myunivokai_nature`.
2. Set `DATABASE_URL` (pooled) and `DATABASE_DIRECT_URL` (direct) with dbname
   `myunivokai_nature`, `sslmode=require`.
3. Migrations run via `go run ./cmd/migrate` locally, or automatically on
   Render with `RUN_MIGRATIONS_ON_START=true` (see `Dockerfile.render`).

Never point these URLs at the universe database — the init migration would
fail immediately (its tables already exist there), by design.

## PUBLIC_WEB_URL (share links)

Set `PUBLIC_WEB_URL` WITH the `/nature` prefix, e.g.
`https://myunivokai-web.onrender.com/nature`. The web client serves nature share
pages under `/nature/share/worlds/{slug}` (universe keeps the unprefixed
route), so the prefix makes the `shareUrl` this service prints resolve to the
right page with zero backend changes.

## Run locally

The committed `.env.local` mirrors universe-service and targets the Docker
hostname `postgres`. To run the API without Docker on the in-memory store,
force the empty database values from `.env.example`:

```powershell
cd services/nature-service
$env:MYUNIVOKAI_ENV_FILE = ".env.example"
go run ./cmd/api          # listens on :8081 (universe-service keeps :8080)
```

For the complete local Postgres → migration → API stack:

```bash
cd services/nature-service
docker compose -f docker-compose-local.yml up --build
```

The local stack publishes the API on `http://localhost:8081` and its dedicated
Postgres database on `localhost:5433`, so it can run beside universe-service.
Both the migration and API containers mount `.env.local` read-only, matching
the universe-service local workflow.
Swagger is available outside production at
`http://localhost:8081/swagger/index.html`.

Create a forest world:

```bash
curl -s -X POST http://localhost:8081/api/v1/worlds \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "Tuan",
    "interests": ["hiking", "music", "photography"],
    "traits": ["curious", "calm", "kind"],
    "goal": "Grow a quiet forest of my own.",
    "mood": "reflective",
    "favoriteColors": ["#8B5CF6", "#06B6D4"],
    "preferredWorldStyle": "aurora"
  }'
```

Direct service endpoints (same shapes as universe-service; the gateway routes
by family prefix and rewrites to `/api/v1`): `POST /api/v1/worlds`,
`GET /api/v1/worlds?ids=…`,
`GET /api/v1/worlds/{id}`, `POST /api/v1/worlds/{id}/variants`,
`POST /api/v1/worlds/{id}/variants/{variantId}/select`,
`POST /api/v1/worlds/{id}/publish`, `GET /api/v1/share/worlds/{slug}`,
`GET /api/v1/healthz`, `GET /api/v1/readyz`.

## Gates

```bash
go vet ./... && go test ./... && go build ./...
```

Regenerate Swagger after changing handlers or response models:

```bash
swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal
```
