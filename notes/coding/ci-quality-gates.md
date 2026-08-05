# CI and quality gates

> **Document status:** Active
> **Last source review:** 2026-07-22

`.github/workflows/ci.yml` runs on every push and pull request to `staging` or
`main`. Jobs are intentionally not path-filtered.

## Contract job

The shared Go module runs module verification, vet, test, and build. The same
job lints `contracts/openapi.yaml` with the pinned Redocly CLI version.

Its tests also **enforce** the JSON Schemas rather than only parsing them
(`contracts/go/schema_conformance_test.go`): the committed fixtures and both
families' golden scenes are validated against the schema that claims to describe
them, and deliberately broken scenes prove the validator rejects. Nothing is
fetched over the network — a `$ref` to an unregistered URL fails compilation, so
a document is only ever checked against schemas in this repository.

This is the gate that catches a builder and its contract drifting apart. It
found four such drifts the first time it ran (wind gust frequency, weather
intensity and both rain-drop counts had outgrown their documented ranges), none
of which any other check could see.

The mutation tests are not optional decoration. A schema can be vacuous — the
universe scene schema mostly asserts which sections must be present — so "the
fixture passed" means nothing until a deletion is shown to fail. Each family
therefore has a set of mutations that must be rejected.

## Golden scene fixtures

Both families commit golden scene configs, and they serve two purposes at once:

| Family | Fixtures | Guards |
| --- | --- | --- |
| Nature | `services/nature-service/internal/services/testdata/forest-golden-*.json` | byte-level builder output, plus forest scene schema conformance |
| Universe | `services/universe-service/internal/services/testdata/universe-golden-*.json` | byte-level builder output, plus universe scene schema conformance |

The service-side test compares bytes: a saved world must render forever, so any
change to what the builder emits for an existing seed is a breaking change.
Regenerate only deliberately, after bumping the family's scene schema version:

```txt
UPDATE_GOLDEN=1 go test ./internal/services -run TestGoldenFixtures          # nature
UPDATE_GOLDEN=1 go test ./internal/services -run TestUniverseGoldenFixtures  # universe
```

The universe cases cover all five themes, because the theme selects palette,
sky, belt, sun and grade — one theme would fix a fifth of the surface.

## Backend jobs

Five independent jobs run in:

- `services/dna-service`;
- `services/universe-service`;
- `services/nature-service`;
- `services/api-gateway`;
- `services/auth-service`.

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

Require all eight jobs before merging to `staging` or `main`:

- `Contracts (lint + vet + test + build)`;
- `Backend (go vet + test)` (legacy display name; the job now also builds);
- `Nature service (go vet + test)` (legacy display name; also builds);
- `DNA service (go vet + test + build)`;
- `Auth service (go vet + test + build)`;
- `API gateway (go vet + test + build)`;
- `Frontend (typecheck + lint + test + build)`;
- `Local Compose configuration`.
