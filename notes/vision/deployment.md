# Deployment — gateway plus two peer APIs

> **Step-by-step operator runbook:**
> [../ops/render-deployment.md](../ops/render-deployment.md) (the "how" — Neon
> setup, Blueprint sync, every env value, rollout smoke tests, Vercel). **This**
> document is the architecture/rationale companion (the "why").

Status: `render.yaml` describes the architecture currently present in source.
The web client remains on Vercel and the databases remain on Neon.

## Service fleet

| Render service | Root | Public responsibility |
| --- | --- | --- |
| `myunivokai-gateway` | `services/api-gateway` | The only browser-facing API origin |
| `myunivokai-api` | `services/universe-service` | Universe domain; direct business routes require gateway key |
| `myunivokai-nature` | `services/nature-service` | Nature domain; direct business routes require gateway key |

All three are Docker web services. The two world APIs each own a logical Neon
database, migrations, worlds, variants, AI logs, and shares. There is no
cross-service database access.

## Why the upstreams still have public URLs

The current Blueprint uses Render free web services. Free services cannot
receive private-network requests, so the gateway must call their public HTTPS
URLs. The `GATEWAY_SHARED_SECRET` boundary prevents public callers from using
business routes directly. A paid move can convert upstreams to private
services later; no public API contract needs to change.

The shared value is created once by the Blueprint environment group
`myunivokai-gateway-secrets` with `generateValue: true` and linked to all three
services. Never create three independent secret values.

## Required values and rollout

The full env-var tables (per service), the Neon two-logical-database setup, the
first-time Blueprint sync, the existing-Blueprint `sync: false` gotcha, the
ordered rollout with smoke tests, and the Vercel step all live in the runbook:
[../ops/render-deployment.md](../ops/render-deployment.md). Two facts worth
keeping here because they shape the architecture:

- The Blueprint defaults both AI providers to `mock`. Nature only wires mock
  today; its Gemini/OpenAI port remains N4 work.
- When updating an **existing** Blueprint, Render does not populate newly added
  `sync: false` variables — they must be entered in the dashboard before syncing.
  The generated secret environment group is managed by the Blueprint.

The frontend now ships a Universe/Forest picker, so it uses **both** the
`/api/universe` and `/api/nature` gateway prefixes (via `NEXT_PUBLIC_API_BASE_URL`
and `NEXT_PUBLIC_NATURE_API_BASE_URL`).

## Health and observability

- gateway `/api/v1/healthz`: process only;
- gateway `/api/v1/statusz`: concurrent upstream readiness, 503 if either is
  unavailable;
- upstream `/api/v1/healthz`: process only, public for Render;
- upstream `/api/v1/readyz`: database readiness, gateway credential required;
- one safe `X-Request-Id` is logged at the gateway and propagated end to end;
- gateway logs client IP, method, path, status, and duration without logging
  secrets or business bodies.

## Free-tier behavior

Each service can sleep independently. A cold gateway request can wake the
gateway and then an upstream, so first-request latency can be material. The
120-second create timeout is aligned with the existing AI generation budget;
short reads and shares use lower timeouts. Circuit breaking prevents a dead
upstream from consuming connection slots indefinitely, but it does not hide a
cold start.

Render documents the free plan as unsuitable for formal production workloads.
For a paid production move, upgrade the gateway first; then consider private
upstreams so the shared header becomes defense in depth instead of the primary
network boundary.

## CI

Every PR runs verify, vet, test, and build for all three Go modules. Frontend
typecheck, lint, test, and build continue independently. No path filters are
used, matching the repository's existing all-jobs policy.
