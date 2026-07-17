# Myunivokai API Gateway

The production public edge for the two peer world APIs. It routes requests
without inspecting business JSON:

| Public gateway path | Upstream path |
| --- | --- |
| `/api/universe/*` | `universe-service /api/v1/*` |
| `/api/nature/*` | `nature-service /api/v1/*` |
| `/api/v1/healthz` | Gateway liveness |
| `/api/v1/statusz` | Aggregated readiness for both upstreams |

The two world services intentionally keep identical route shapes. The gateway
prefix is the family selector; for example, `POST /api/nature/worlds` becomes
`POST /api/v1/worlds` at nature-service.

## What the gateway owns

- request IDs, structured access logging, panic recovery, security headers;
- exact-origin CORS and one per-client token bucket across both services;
- a 64 KiB request-body ceiling, matching the existing world handlers;
- route timeouts: 120s create, 5s public share, 15s other API calls;
- transport error envelopes, per-upstream circuit breakers, and a bounded
  60-second in-memory cache for successful public share responses;
- `X-Forwarded-*` sanitation and injection of `X-Gateway-Key`.

There is no user authentication yet because the repository has no auth
service or user identity contract. `GATEWAY_SHARED_SECRET` authenticates the
gateway process to the two upstream services; it is not a user token. The
gateway overwrites any client-supplied `X-Gateway-Key` before proxying.

## Run locally

Start universe-service on port 8080 and nature-service on port 8081, then:

```bash
cd services/api-gateway
go run ./cmd/gateway
```

The gateway listens on port 8082 by default:

```bash
curl http://localhost:8082/api/v1/healthz
curl http://localhost:8082/api/v1/statusz
curl "http://localhost:8082/api/universe/worlds?ids=<world-id>"
curl http://localhost:8082/api/nature/share/worlds/<share-slug>
```

To run only the gateway in Docker while both upstream APIs run on the host:

```bash
docker compose -f docker-compose-local.yml up --build
```

`.env.local` keeps the shared credential empty for backwards-compatible,
standalone local service development. Set the same non-empty value in all
three processes when locally testing upstream access enforcement.

## Checks

```bash
go mod verify
go vet ./...
go test ./...
go build ./...
docker build -t myunivokai-api-gateway .
docker compose -f docker-compose-local.yml config
```

## Production requirements

`APP_ENV=production` fails startup unless:

- both upstream URLs are absolute HTTPS URLs;
- `TRUST_PROXY=true`;
- CORS has at least one explicit origin and no wildcard;
- `GATEWAY_SHARED_SECRET` contains at least 32 characters.

The root `render.yaml` links one generated secret environment group to all
three services. Because the free Render upstreams remain publicly addressable,
their root and liveness endpoints stay public for platform probes while
readiness and every business route require the gateway credential.
