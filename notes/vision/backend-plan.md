# Backend plan — current peer-service architecture

Status: the original modular-monolith/stateless-composer proposal was
superseded by the owner's 2026-07-16 decision and by the source now present.
This file records the active boundaries instead of describing code that does
not exist.

## Current services

```txt
api-gateway
  /api/universe/* -> universe-service /api/v1/* -> universe database
  /api/nature/*   -> nature-service   /api/v1/* -> nature database
```

Universe and Nature are full peers. Each owns its complete mechanism:

```txt
input -> provider/orchestrator -> validated family DNA
      -> deterministic seeded config builder
      -> transactional world + variant + AI log store
      -> regenerate/select/publish/share
```

There is no central world-service, remote compose endpoint, shared world
database, composer registry, or `scene-nature-service` in source. Those were
options from the original proposal and must not be implemented as if they were
current contracts.

## Rules that remain active

- Business services depend on the local `ai.Provider` interface, never a
  provider SDK or frontend call.
- AI generates semantic DNA only. Every visual number comes from deterministic
  PRNG streams within named bounds.
- Regenerate variants without AI by default.
- Public share responses never include raw personal input.
- Each peer owns its storage and migrations; no cross-service database reads.
- A third family should join an existing peer unless its independent deploy or
  load is justified. Do not extract a shared Go library before actual drift at
  three services makes that cheaper than duplication.

## Gateway boundary

The gateway owns public routing, request IDs, client-IP rate limiting, CORS,
request limits, timeouts, transport failure mapping, circuit breakers, and the
short public-share cache. Domain services own validation and all business
errors.

Because current Render free upstreams are public web services, readiness and
business routes require the shared gateway key. This is internal service
authentication only. User auth remains deferred until a real user/identity
contract exists.

## Language choice

Go remains the default for gateway and scene/world services. Rust becomes a
candidate only if measured p95 deterministic build time exceeds 50 ms or a
service starts baking binary assets such as meshes, textures, or heightmaps.
The current builders output JSON numbers and do not justify a second toolchain.

## Next backend work grounded in source

1. Deploy and smoke the gateway fleet using [deployment.md](deployment.md).
2. Complete Nature N4 only when real Gemini/OpenAI output is wanted; mock is
   intentionally the current Nature provider.
3. Add contract-schema validation for forest golden fixtures to prevent schema
   and executable fixture drift.
4. Revisit user auth only after defining users, token issuer, claims, and route
   authorization. Do not add a placeholder auth-service.
