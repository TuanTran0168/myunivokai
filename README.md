# Myunivokai

My universe, okay? You describe yourself in a short form, AI distills it into a
"Personality DNA", the backend turns that into a deterministic world config,
and the frontend renders your own solar system in 3D with three.js. You can
regenerate variants, keep a gallery, and publish a public share link.

## Live

| What | URL |
| --- | --- |
| Web (production, Vercel) | <https://myunivokai.vercel.app> |
| API (production, Render) | <https://myunivokai.onrender.com/api/v1> |
| API health check | <https://myunivokai.onrender.com/api/v1/healthz> |
| Swagger UI (local development only) | <http://localhost:8080/swagger/index.html> |

Swagger documents internal endpoints, so the route is only mounted outside
production (`internal/handlers/router.go`) — on Render (`APP_ENV=production`)
it intentionally returns 404. The Render free plan sleeps after ~15 minutes of
inactivity; the first request after that takes up to ~50 seconds to wake the
API.

## How it works

```txt
Form (Next.js)
  -> POST /api/v1/worlds (Go)
  -> AI provider (Gemini/OpenAI/mock) generates schema-constrained Personality DNA JSON
  -> backend validates the DNA, creates a World Seed + World Scene Config (deterministic, AI-free)
  -> stored in PostgreSQL (or in-memory during development)
  -> frontend reads the config and renders the solar system with React Three Fiber
```

Two architecture decisions worth knowing:

1. AI only generates the semantic part (archetype, scene name, planet
   meanings). Every 3D number is derived by the backend from a seed within safe
   bounds — so "regenerate variant" costs zero AI calls, and the same seed
   always renders the same scene.
2. AI providers sit behind a single interface. Switching Gemini to OpenAI is an
   `AI_PROVIDER` env change, not a code change. `mock` powers tests and
   key-less development.

## Repository layout

```txt
services/universe-service   Go + chi + pgxpool; the universe domain (worlds, DNA, variants, share)
clients/web-client          Next.js 14 + TypeScript + Tailwind + React Three Fiber
contracts                   JSON schemas + OpenAPI shared by both sides
docs                        Early architecture notes
notes                       Internal docs for humans and AI agents (start at notes/README.md)
```

The layout is microservices-ready: future services (`services/match-service`,
`services/auth-service`) and clients (`clients/mobile-client`) slot in
alongside the existing ones.

## Run the backend

```bash
cd services/universe-service
go run ./cmd/api
```

Defaults to `AI_PROVIDER=mock`. With an empty `DATABASE_URL` the API uses an
in-memory store, so local development needs no database. Example env lives in
`services/universe-service/.env.example`.

The config loader reads `.env`, `.env.local`, and environment-specific files
(`.env.dev`, `.env.prod`, ...). Force a specific file with `APP_ENV=prod` or
`MYUNIVOKAI_ENV_FILE=.env.prod`.

Health checks and Swagger:

```bash
curl http://localhost:8080/api/v1/healthz   # liveness
curl http://localhost:8080/api/v1/readyz    # readiness (pings the store)
# http://localhost:8080/swagger/index.html  (disabled in production)

curl https://myunivokai.onrender.com/api/v1/healthz   # production liveness
```

Regenerate Swagger after changing handlers/models:

```bash
swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal
```

## Run the frontend

```bash
cd clients/web-client
npm install
npm run dev
```

Open http://localhost:3000. The FE calls the API through
`NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080/api/v1`, example env
in `clients/web-client/.env.example`).

Create a world from the form — the Live DNA Preview renders a solar system that
updates live with your inputs (palette, mood, interests, traits), and submitting
opens the generated world on its own page.

## Run with Docker Compose

```bash
cd services/universe-service
docker compose -f docker-compose-local.yml up --build
```

This starts PostgreSQL, runs goose migrations, then serves the API on port
8080. The local stack mounts `.env.local` into the API and migration containers.

## Tests and checks

```bash
# Backend
cd services/universe-service && go test ./... && go vet ./...

# Frontend
cd clients/web-client && npm run typecheck && npm run lint && npm run test && npm run build
```

Backend tests always use the mock provider — no real AI calls. CI (GitHub
Actions) runs the Go test suite plus the frontend typecheck, lint, and build on
every PR into `staging`/`main`. (The frontend vitest suite runs locally; wiring
it into CI is tracked in `notes/fe/refactor-plan.md`.)

## Documentation

- `notes/README.md` — index of internal docs (git convention, coding style, FE/BE architecture)
- `notes/fe/threejs-scene-architecture.md` — how three.js is used and how to add new scene types
- `notes/perf-render-plan.md` — the gallery-429 root cause, batch endpoint design, and the Render deploy kit
- `AGENTS.md` — rules for AI agents working in this repo

Planet textures come from Solar System Scope (CC BY 4.0); attribution lives in
`clients/web-client/public/textures/solar-system/ATTRIBUTION.md`.

## Deployment

Production runs the web client on Vercel, the API on Render (Docker), and the
database on Neon PostgreSQL. Live URLs are in the [Live](#live) section.

### API on Render

`render.yaml` at the repo root is a Render Blueprint for the API service. It
builds `services/universe-service/Dockerfile.render`; the container entrypoint
(`docker-entrypoint-render.sh`) runs goose migrations first when
`RUN_MIGRATIONS_ON_START=true` (against `DATABASE_DIRECT_URL`), then starts the
API. Render injects `PORT` at runtime — the config reads `API_PORT` first, then
`PORT` (`internal/config/config.go`), so no port setting is needed.

Secrets are declared `sync: false` in the blueprint: their values live only in
the Render dashboard (Environment tab), never in git. A local, untracked
cheat-sheet with the production values is kept at
`services/universe-service/.env.render` (`.gitignore` excludes all `.env.*`).

- Neon connection strings: the pooled URL (host contains `-pooler`) for
  `DATABASE_URL` (runtime), the direct URL for `DATABASE_DIRECT_URL`
  (migrations); both with `sslmode=require`, without `channel_binding=require`
  (not a pgx option).
- CORS: `API_ALLOWED_ORIGINS=https://myunivokai.vercel.app` — the exact web
  origin, never a wildcard, no trailing slash.
- AI: the blueprint defaults to `AI_PROVIDER=mock` (no key needed). Switch to
  `gemini`/`openai` plus the matching API key in the dashboard for real
  generation.

### Web on Vercel

Set `NEXT_PUBLIC_API_BASE_URL=https://myunivokai.onrender.com/api/v1` in
Vercel → Project → Settings → Environment Variables (Production). Next.js
inlines `NEXT_PUBLIC_*` values at build time, so after changing one, redeploy
without the build cache. Cheat-sheet: `clients/web-client/.env.render`
(untracked).
