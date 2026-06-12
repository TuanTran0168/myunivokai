# CI & Quality Gates (shared FE + BE)

Status: DONE — merged as `feat/ci/github-actions` (simplified after the initial
paths-filter version kept failing on repo action policy).

## What runs

`.github/workflows/ci.yml` runs on every PR into `staging` and `main`:

```txt
job backend:   cd services/universe-service -> go mod verify -> go vet -> go test
job frontend:  cd clients/web-client -> npm ci -> typecheck -> lint -> build
```

- Both jobs always run (no third-party path filter; reliability beats saving
  ~2 minutes in a small repo).
- Go/Node dependency caching; superseded runs are cancelled (concurrency group).
- A frontend `npm run test` step is reserved for `feat/fe/unit-testing-setup`.

## Recommended repo settings

Enable branch protection for `staging` and `main`: require both status checks
("Backend (go vet + test)", "Frontend (typecheck + lint + build)") to pass
before merging.
