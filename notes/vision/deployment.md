# Deployment plan — from two deploys to a service fleet

Part of the [vision folder](README.md).

## Phase 1 — nothing changes (that is the point)

Vercel (web) + one Render service + Neon, exactly as deployed today. New
families are new Go packages and new FE folders inside the same two deploys.

## Phase 2 on Render — multi-service blueprint

`render.yaml` grows one entry per scene service:

```yaml
  - type: web
    name: myunivokai-scene-nature
    runtime: docker
    rootDir: services/scene-nature-service
    dockerfilePath: ./Dockerfile.render
    plan: free                      # see the free-tier trap below
    healthCheckPath: /internal/v1/healthz
    envVars:
      - key: INTERNAL_API_KEY
        sync: false                 # same value pasted into world-service
```

- world-service gains `SCENE_NATURE_SERVICE_URL`, `SCENE_CITY_SERVICE_URL`,
  `INTERNAL_API_KEY`.
- **Render free tier has no private services** — every free service gets a
  public URL. Until we pay for private networking, internal endpoints are
  protected by the `X-Internal-Key` shared secret (checked in middleware,
  401 otherwise) and by not being in the public OpenAPI. This is honest
  screening, not real network isolation — acceptable for compose endpoints
  that hold no secrets and mutate nothing.
- Database: **only world-service** has `DATABASE_URL` and runs migrations.
  Scene services have no state — their entire config is the internal key.

## The free-tier trap (read before approving Phase 2)

Each free Render service sleeps independently after ~15 min. A cold visitor
then pays: world-service wake (~50 s) + scene service wake (~50 s) =
**up to ~100 s** for the first world creation. Mitigations, in order of
preference:

1. **Stay in Phase 1 until traffic exists** (this plan's default posture).
2. One `starter` instance ($7/mo) for world-service only; scene services stay
   free (they are only hit after world-service is already awake, and compose
   retries + the 503 taxonomy make a cold scene service a "try again", not a
   bug).
3. Consolidation escape hatch (decision D5): because composers are plain Go
   packages, world-service can always link a family in-process behind the
   same Registry interface (`SCENE_CITY_MODE=embedded` vs `remote`). We can
   extract AND un-extract per family with an env flag — this de-risks the
   whole phase.

## CI

GitHub Actions gets per-service jobs gated by path filters so a
scene-service PR runs only its own vet/test/build:

```yaml
on:
  pull_request:
    paths: ["services/scene-nature-service/**"]
```

Frontend job unchanged (typecheck + lint + vitest + build, already in CI).

## Observability

- `X-Request-Id` propagated end-to-end (FE → world → scene) — already issued
  today; scene services log it via the same zerolog setup.
- Each service: `/healthz` (liveness) + `/readyz`; the gateway's `/statusz`
  (Phase 3) aggregates readyz of all upstreams for one-glance ops.
- Compose latency logged per call with `scene_type`, so the Rust trigger in
  the [backend plan](backend-plan.md) is a query, not a guess.

## Platform alternatives (noted, not chosen)

Render stays the default. If Phase 2 lands and private networking or CPU
pricing starts to hurt: Fly.io offers free private networking between
machines and per-second billing (good for bursty Rust composers); Railway is
comparable to Render. Re-evaluate only with real traffic numbers.
