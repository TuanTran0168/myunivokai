# Implemented product capabilities

> **Document status:** Active source-backed inventory of the pre-migration platform
> **Last source review:** 2026-07-22

> These stories remain accurate for source reviewed on 2026-07-22. They are not
> the approved target. Sprint 1 replaces HTTP peer routing, local in-memory edge
> state and the current local topology; see
> [Vision V1 solution architecture](../vision/versions/v1-2026-07-22/solution-architecture.md).

## US-CURRENT-001 — One browser API origin

Status: Implemented

As a frontend user,
I want every API request to use one gateway origin,
so that deployment and browser security policy have one public edge.

Scenario: Route a selected family

Given the web client is built with `NEXT_PUBLIC_GATEWAY_BASE_URL`
When it requests a Universe or Nature operation
Then it calls `/api/universe/*` or `/api/nature/*` on that gateway origin
And no peer-service hostname is frontend configuration.

Source evidence:

- `clients/web-client/src/lib/gateway.ts`
- `clients/web-client/src/lib/api.ts`
- `services/api-gateway/internal/routing/table.go`
- `render.yaml`

## US-CURRENT-002 — Create both portrait families

Status: Implemented

As a visitor,
I want to choose Universe or Forest from the create screen,
so that the same personal input can become a different visual medium.

Scenario: Generate a family-specific world

Given the create page shows the Universe/Forest picker
When the visitor submits the form for one family
Then the request reaches that family's peer service through the gateway
And the resulting page uses the matching deterministic renderer and family
route state.

Source evidence:

- `clients/web-client/src/app/page.tsx`
- `clients/web-client/src/features/scene-renderers/registry.ts`
- `services/universe-service/internal/services/world_service.go`
- `services/nature-service/internal/services/world_service.go`

## US-CURRENT-003 — Regenerate without another AI call

Status: Implemented

As a world owner,
I want a new visual variant without another provider request,
so that experimentation is fast, deterministic, and inexpensive.

Scenario: Regenerate a variant

Given a stored world already has semantic DNA
When the client posts to its variants endpoint
Then the peer creates a new seed/config through its deterministic builder
And it does not invoke the AI provider.

Source evidence:

- `services/universe-service/internal/services/world_service.go`
- `services/nature-service/internal/services/world_service.go`
- their `world_service_test.go` files

## US-CURRENT-004 — Prevent direct peer bypass

Status: Implemented

As a platform operator,
I want public peer business routes to accept only gateway traffic,
so that callers cannot bypass edge CORS, rate limits, and request verification.

Scenario: Call a peer without the gateway credential

Given production peers share a 32+ character gateway secret with the gateway
When a caller requests readiness or a business/share route directly without
the valid `X-Gateway-Key`
Then the peer returns 401
And the gateway overwrites any client-supplied key before forwarding.

Source evidence:

- both peers' `internal/middleware/gateway_authentication.go`
- `services/api-gateway/internal/proxy/reverse_proxy.go`
- `services/api-gateway/internal/handlers/router_test.go`

## US-CURRENT-005 — Publish privacy-safe share pages

Status: Implemented

As a world owner,
I want to publish a shareable 3D portrait,
so that other people can view its meaning without receiving my raw personal
input.

Scenario: Read a published world

Given a selected variant has been published
When a visitor opens the family-specific share route
Then the frontend fetches it through the gateway and renders the selected scene
And the public response model omits raw `WorldInput`.

Source evidence:

- both peers' `internal/handlers/share_handler.go`
- both peers' `internal/models/responses.go`
- both frontend share routes under `src/app/`

## US-CURRENT-006 — Start the full local topology once

Status: Implemented

As a developer,
I want one local command to run web, gateway, both APIs, migrations, and both
databases,
so that localhost exercises the production request boundary.

Scenario: Start the integrated stack

Given Docker is running
When the developer runs `docker compose -f docker-compose-local.yml up --build`
Then the two databases become healthy before migrations and peers
And the gateway waits for both peers
And the web client is built against only `http://localhost:8082`.

Source evidence:

- root `docker-compose-local.yml`
- root `Makefile`
- `.vscode/tasks.json`

