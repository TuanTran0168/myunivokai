# Vision — Myunivokai as a multi-scene platform

Status: detailed proposal (2026-07-03), written against the current codebase.
Owner approval is tracked by the [decision points](#decision-points-for-approval)
below — approve those five and step 1a of the roadmap can start immediately.

## Documents in this folder

| Document | Content |
| --- | --- |
| [backend-plan.md](backend-plan.md) | SceneComposer registry (Phase 1), scene-service extraction (Phase 2), Go vs. Rust |
| [api-gateway.md](api-gateway.md) | Gateway responsibilities, options compared, hand-rolled Go gateway design (Phase 3) |
| [frontend-plan.md](frontend-plan.md) | sceneType-first lazy renderer registry, type unions, mirror discipline, create-form evolution |
| [deployment.md](deployment.md) | Render multi-service blueprint, the free-tier trap, CI, observability |
| [contracts-and-roadmap.md](contracts-and-roadmap.md) | Schema versioning rules, phased roadmap with triggers, risk table |

## The idea

Today Myunivokai paints one kind of portrait: a solar system. The vision is a
family of scene types, each a different "medium" for the same person:

| Scene family | What the DNA drives |
| --- | --- |
| Universe (today) | Planets, orbits, palette, mood lighting |
| City | Skyline shape, district density, neon vs. lantern light, traffic pulse |
| Forest & mountains | Ridge silhouettes, tree density, fog banks, altitude |
| Rivers & streams | Meander curvature, flow speed, banks, stones |
| Lakes | Stillness, reflections, shore vegetation, weather |

Long-term, each scene family is owned by its own backend service and rendered
by its own frontend renderer. One Personality DNA, many worlds.

## Why the current architecture already points there

Three rules are already enforced — every new family must keep honoring them:

1. **Personality DNA is theme-agnostic.** The AI produces semantics only
   (archetype, trait scores, planet meanings, energy signature) — never
   visual numbers. A city composer and a lake composer consume the same DNA.
2. **Determinism.** `seed.NewPRNG(seed)` drives every visual number inside
   safe bounds; the same seed always renders the same scene, and regenerating
   a variant costs zero AI calls.
3. **Mirrored parameters.** Tunables live on both sides and must stay in sync
   (today: `mood_scene_profile.go` ↔ `scene.ts` preview builder).

Concrete anchors in today's code:

| Piece | Where | Role in this plan |
| --- | --- | --- |
| `WorldConfigBuilder.Build(...)` | `internal/services/world_config_builder.go` | Already a pure function `(DNA, seed, variantNo, input) -> scene config`. It IS the first SceneComposer — it just doesn't know it yet. |
| `WorldSceneConfig` envelope | `internal/models/scene.go` | Has `schemaVersion` + `theme`; needs a `sceneType` discriminator. |
| FE renderer registry | `features/scene-renderers/registry.ts` | Maps `theme` → renderer; 5 themes all resolve to `SolarSystemRenderer`. Becomes `sceneType`-first. |
| `SceneRendererProps` contract | `features/scene-renderers/types.ts` | Every renderer already implements one shared prop shape. |
| Shared 3D infra | `features/scene-renderers/shared/` | CameraRig, StarParticleField, PostEffects, CanvasLoader — scene-agnostic today, stays that way. |
| Scene config JSON Schema | `contracts/schemas/world-scene-config.schema.json` | Becomes the solar-system family schema under `contracts/scenes/`. |

## Target architecture in three phases

```txt
Phase 1 — modular monolith          Phase 2 — extracted services          Phase 3 — platform
 (theme registry, one deploy)        (scene services, facade routing)      (gateway, auth, async)

 ┌─────────────────────────┐         ┌─────────────────────────┐          ┌───────────────┐
 │    universe-service     │         │      world-service      │          │  api-gateway  │
 │  ┌───────────────────┐  │         │  (catalog: worlds, DNA, │          │ (routing, CORS│
 │  │ composer registry │  │         │   variants, share, DB)  │          │ rate limit,   │
 │  │  solar-system     │  │         └───────┬─────────┬───────┘          │ auth, retries)│
 │  │  city             │  │                 │  HTTP   │                  └──┬───┬───┬────┘
 │  │  nature           │  │         ┌───────┴──┐ ┌────┴───────┐             │   │   │
 │  └───────────────────┘  │         │scene-city│ │scene-nature│        world auth scene-*
 └─────────────────────────┘         │ (pure fn)│ │  (pure fn) │        svc  svc  services
                                     └──────────┘ └────────────┘
```

Phase transitions have explicit triggers (see
[contracts-and-roadmap.md](contracts-and-roadmap.md)) — we never split
"because microservices".

## Product ideas to make it delightful

- **The AI picks your medium.** Map DNA archetypes to a default family — a
  contemplative archetype becomes a lake, an ambitious one a skyline, an
  adventurous one a mountain range. The user can always override.
- **Portrait series.** One DNA rendered as universe + city + lake; the share
  page becomes a small gallery of the same soul in three mediums (enabled by
  decision D1: scene type per variant).
- **Cross-scene consistency.** The same palette and mood tokens drive every
  family, so your city glows in the same colors as your universe.
- **Time and seasons as variant dimensions.** For terrestrial scenes,
  "regenerate variant" can also move time-of-day or season — still
  seed-deterministic.
- **Sound signatures.** A per-family ambient audio bed derived from
  `energySignature` (city hum, forest birdsong, lake water) — muted by default.

## What NOT to do yet

- **Do not split services before a second family exists in code.** Phase 1's
  registry comes first; premature microservices multiply cold starts,
  deploys, and env management on the free tier for zero user value.
- **Do not put AI calls inside scene services.** AI stays in the
  world-service DNA step only — that is the cost-control and determinism
  boundary.
- **Do not fork the DNA schema per family.** DNA stays universal; only the
  composers differ.

## Decision points for approval

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | `scene_type` lives on world_variants (enables "portrait series": one world, variants in different mediums) vs. on worlds | **variants** |
| D2 | Language: Go for all scene services; Rust only when p95 compose > 50 ms or server-side asset baking appears | **Go now, Rust by trigger** |
| D3 | Gateway: world-service stays the facade until auth-service; then hand-rolled Go gateway | **facade now, Go gateway at Phase 3** |
| D4 | Forest/mountain/river/lake = one `scene-nature-service` with themes, not four services | **one nature service** |
| D5 | Phase 2 ships with an embedded/remote per-family flag so extraction is reversible on the free tier | **yes** |
