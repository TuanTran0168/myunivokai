# Contracts, roadmap, and risks

> **Document status:** Active after source re-baseline
> **Last source review:** 2026-07-18

Part of the [vision folder](README.md). This replaces the old
modular-monolith/extraction roadmap, which no longer matches the two-peer
service architecture.

## Compatibility policy

- Saved worlds must continue rendering after deploys.
- Additive optional fields require deterministic defaults in the frontend.
- Breaking output changes require a new `schemaVersion`, an old-version reader
  or pure upgrade function, and fixed fixtures.
- PRNG features use new named streams; never insert draws into an existing
  stream and silently change old worlds.
- The gateway rewrites transport paths only. Domain contracts remain owned by
  Universe and Nature.

## Contract inventory from source

| Contract | Current state | Gap |
| --- | --- | --- |
| Universe scene | Go model + `contracts/schemas/world-scene-config.schema.json`, schema 1.2 | No explicit `sceneType`; schema is outside the family folder; no JSON golden fixture |
| Forest scene | Go model + `contracts/scenes/forest-scene-config.schema.json` + four golden fixtures, schema 1.2 | Golden bytes are not validated against the JSON Schema in CI |
| Public HTTP | Two generated Swagger 2.0 documents for direct `/api/v1` peer routes | Gateway-prefixed public routes have no complete OpenAPI document; root `contracts/openapi.yaml` only contains health |
| Frontend types | Hand-written `lib/types.ts` and defensive normalizers | Broad optional `SceneConfig`, `any` normalizers, no generated/type-drift gate |
| Profile mirrors | Go builders plus `scene.ts` / `forestScene.ts` preview mirrors | No shared profile-version assertion across languages |

## Prioritized roadmap

| Priority | Work | Why now | Done when |
| --- | --- | --- | --- |
| P0 | Live Render deployment verification | Config exists but has not been proven on the real fleet | Runbook evidence covers health, status, direct-peer 401, create/get/regenerate/publish/share for both families, and browser single-origin traffic |
| P0 | Next.js supported-major migration | `npm audit --omit=dev --audit-level=high` currently fails on the Next 14 tree | Typecheck/lint/test/build and production audit are green without force-installing an unreviewed major |
| P0 | Executable contract baseline | Current schemas, Swagger, Go models, and TS types can drift independently | Universe emits explicit `sceneType`; both family schemas live under `contracts/scenes`; public Gateway OpenAPI is complete; fixtures validate against schemas; FE types/runtime validation derive from or are checked against the contract |
| P1 | Renderer and asset delivery budget | Both family renderers are eagerly imported; static 3D assets exceed 40 MB; Nature uses a remote Draco decoder | Separate family chunk proven in network trace; decoder is self-hosted; catalog/file/license tests pass; budgets are recorded in CI or a reproducible report |
| P1 | Adaptive 3D quality and recovery | DPR up to 3 and full effects have no weak-device feedback loop | Measured tiers adapt DPR/shadows/effects/particle counts; WebGL failure has a usable fallback; deterministic scene identity remains unchanged |
| P1 | Observability | Request IDs/logs exist, but no metrics or distributed traces | Gateway and peers expose latency/error/saturation signals; one request can be followed end-to-end without logging personal input or secrets |
| P2 | Gateway horizontal scaling | Rate limits, share cache, and circuit state are process-local | Scale trigger is measured; shared state is introduced only where semantics require it and failure behavior is documented |
| P2 | Nature real AI providers | Nature factory currently supports mock only | Gemini/OpenAI adapters pass structured-output/repair/fallback tests and mock remains test/default-safe |
| Deferred | User authentication | No user/account/ownership contract exists | Product first defines issuer, subject, ownership, anonymous migration, and route authorization; only then implement auth |
| Discovery | Third scene family | City/room/lake would add a large asset and art-direction surface | An approved story names its service owner, schema, renderer, asset/license budget, and measurable product value |

## Current risks

| Risk | Evidence | Mitigation |
| --- | --- | --- |
| Documentation claims exceed deployed reality | Render configuration is committed, but live smoke evidence is absent | Keep deployment status “pending verification” until the runbook passes |
| Contract drift | Placeholder root OpenAPI, hand-written FE types, schemas not exercised together | Complete the executable-contract P0 before a third family |
| Frontend security debt | Current production dependency audit fails | Isolate the Next migration in its own branch and validate all existing routes |
| Weak-device frame drops | DPR up to 3, continuous animation, HDRI/shadows/post effects | Adaptive quality story with frame-time measurements |
| External decoder availability | Drei defaults Draco to Google CDN | Self-host versioned decoder files with the web client |
| Asset/license drift | Forest catalog has no filesystem/attribution test | Catalog validation plus attribution and size budget in CI |
| Per-instance gateway behavior | In-memory limiter/cache/circuit breaker | Run one instance now; define Redis/shared-state semantics before scale-out |
| Premature service growth | Every family repeats DB, AI, renderer, asset, and deploy cost | Require an ownership/traffic/art-direction trigger, not “microservices by default” |

Detailed Given/When/Then scenarios are in
[../user-stories/engineering-backlog.md](../user-stories/engineering-backlog.md).
