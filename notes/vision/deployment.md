# Deployment — gateway plus two peer APIs

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

## Required Render values

Gateway:

```txt
API_ALLOWED_ORIGINS=https://myunivokai.vercel.app
UNIVERSE_SERVICE_URL=https://<universe-service-host>
NATURE_SERVICE_URL=https://<nature-service-host>
```

Universe service:

```txt
DATABASE_URL=<universe pooled Neon URL>
DATABASE_DIRECT_URL=<universe direct Neon URL>
PUBLIC_WEB_URL=https://myunivokai.vercel.app
```

Nature service:

```txt
DATABASE_URL=<nature pooled Neon URL using its own logical database>
DATABASE_DIRECT_URL=<nature direct Neon URL using its own logical database>
PUBLIC_WEB_URL=https://myunivokai.vercel.app
```

The Blueprint defaults both AI providers to mock. Nature only wires mock today;
its Gemini/OpenAI port remains N4 work.

Important Blueprint behavior: when updating an existing Blueprint, Render does
not populate newly added `sync: false` variables. Add the three gateway values
in the dashboard before/while syncing this change. The generated environment
group is managed by the Blueprint.

## Rollout order

1. Confirm both database URL pairs point at their own logical database.
2. Add the gateway's three `sync: false` values in Render.
3. Sync `render.yaml`; verify the generated secret group is linked to all three
   services.
4. Wait for direct upstream liveness:
   `/api/v1/healthz` must return 200 on Universe and Nature.
5. Verify direct `/api/v1/readyz` and `/api/v1/worlds` return 401 without
   `X-Gateway-Key`.
6. Verify gateway `/api/v1/healthz` returns 200 and `/api/v1/statusz` reports
   both services ready.
7. Smoke create/get/regenerate/publish/share through both public prefixes.
8. Set Vercel `NEXT_PUBLIC_API_BASE_URL` to
   `https://<gateway-host>/api/universe` and redeploy without build cache.

The current frontend is Universe-only, so it uses the Universe prefix. The
Nature prefix is ready for the later frontend family picker.

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
