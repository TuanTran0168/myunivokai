# CI and quality gates

> **Document status:** Active
> **Last source review:** 2026-07-22

`.github/workflows/ci.yml` runs on every push and pull request to `staging` or
`main`. Jobs are intentionally not path-filtered.

## Contract job

The shared Go module runs module verification, vet, test, and build. The same
job lints `contracts/openapi.yaml` with the pinned Redocly CLI version.

## Backend jobs

Four independent jobs run in:

- `services/dna-service`;
- `services/universe-service`;
- `services/nature-service`;
- `services/api-gateway`.

Each runs:

```txt
go mod verify -> go vet ./... -> go test ./... -> go build ./...
```

## Frontend job

```txt
npm ci -> npm run typecheck -> npm run lint -> npm run test -> npm run build
```

Go and npm dependency caches are enabled, and the concurrency group cancels a
superseded run on the same ref.

## Local environment job

The root Compose graph is rendered with `.env.local` so invalid includes,
interpolation, service references, or Compose syntax fail in CI without
requiring the containers to start.

## Branch protection

Require all seven jobs before merging to `staging` or `main`:

- `Contracts (lint + vet + test + build)`;
- `Backend (go vet + test)` (legacy display name; the job now also builds);
- `Nature service (go vet + test)` (legacy display name; also builds);
- `DNA service (go vet + test + build)`;
- `API gateway (go vet + test + build)`;
- `Frontend (typecheck + lint + test + build)`;
- `Local Compose configuration`.
