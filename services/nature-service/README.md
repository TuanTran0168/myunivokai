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
This is round **N1**: the whole pipeline on an in-memory store. Persistence
(own Neon database + goose migrations) and the Render deploy are round N2 —
until then the service refuses to start with `APP_ENV=production`.

## Run locally

```bash
cd services/nature-service
go run ./cmd/api          # listens on :8081 (universe-service keeps :8080)
```

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

Endpoints (same shapes as universe-service, so a future gateway routes by
path prefix alone): `POST /api/v1/worlds`, `GET /api/v1/worlds?ids=…`,
`GET /api/v1/worlds/{id}`, `POST /api/v1/worlds/{id}/variants`,
`POST /api/v1/worlds/{id}/variants/{variantId}/select`,
`POST /api/v1/worlds/{id}/publish`, `GET /api/v1/share/worlds/{slug}`,
`GET /api/v1/healthz`, `GET /api/v1/readyz`.

## Gates

```bash
go vet ./... && go test ./... && go build ./...
```
