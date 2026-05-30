# Myunivokai

My universe, okay? Turn your personality into a living 3D universe.

## Apps

- `apps/api`: Go API for validation, AI orchestration, persistence, and world generation.
- `contracts`: JSON schemas and OpenAPI skeletons shared by frontend/backend.
- `docs`: Architecture and implementation notes.

## Run API locally

```bash
cd apps/api
go mod tidy
go test ./...
go run ./cmd/api
```

The API defaults to `AI_PROVIDER=mock`. If `DATABASE_URL` is empty, it uses an in-memory store so local development and tests do not need Neon. Backend env examples live in `apps/api/.env.example`.

Backend env loading supports `.env`, `.env.local`, plus app-specific files such as `.env.dev`, `.env.development`, `.env.prod`, and `.env.production`. Set `APP_ENV=prod` or `MYUNIVOKAI_ENV_FILE=.env.prod` when you want to force a specific file.

## Run with Docker Compose

```bash
cd apps/api
docker compose -f docker-compose-local.yml up --build
```

This starts PostgreSQL, runs goose migrations, then starts the API at `http://localhost:8080`.
The local compose stack mounts `apps/api/.env.local` into the API and migration containers. The Go app loads that file at startup through `config.Load()`.

Health check:

```bash
curl http://localhost:8080/api/v1/healthz
```

Swagger UI:

```txt
http://localhost:8080/swagger/index.html
```

Regenerate Swagger after changing handlers/models:

```bash
cd apps/api
swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal
```
