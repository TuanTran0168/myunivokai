# CI and quality gates

`.github/workflows/ci.yml` runs on every push and pull request to `staging` or
`main`. Jobs are intentionally not path-filtered.

## Backend jobs

Three independent jobs run in:

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

## Branch protection

Require all four jobs before merging to `staging` or `main`:

- `Backend (go vet + test)` (legacy display name; the job now also builds);
- `Nature service (go vet + test)` (legacy display name; also builds);
- `API gateway (go vet + test + build)`;
- `Frontend (typecheck + lint + test + build)`.
