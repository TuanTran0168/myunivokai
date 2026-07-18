# Vision — Myunivokai as a multi-scene platform

> **Document status:** Active
> **Last source review:** 2026-07-18

Status: **active, gateway amendment implemented**. The original
decision points below were approved, and the owner additionally decided the
vision becomes **microservices immediately** — starting with the nature
family as a full peer service (same mechanism as universe-service, different
DNA). See [Owner decisions (2026-07-16)](#owner-decisions-2026-07-16) and the
detailed [nature-service-plan.md](nature-service-plan.md).

## Documents in this folder

| Document | Content |
| --- | --- |
| [backend-plan.md](backend-plan.md) | Current peer-service backend boundaries and next source-grounded work |
| [api-gateway.md](api-gateway.md) | Implemented Go gateway behavior, security boundary, route policies, failure taxonomy |
| [frontend-plan.md](frontend-plan.md) | Implemented sceneType-first baseline plus pending lazy chunks, typed contracts, and performance tiers |
| [deployment.md](deployment.md) | Current four-service Render blueprint, rollout, free-tier behavior, observability |
| [contracts-and-roadmap.md](contracts-and-roadmap.md) | Current source gaps, schema compatibility policy, and prioritized roadmap |
| [visual-diversity.md](visual-diversity.md) | Implemented diversity baseline, remaining delivery/performance gaps, and researched model sources |
| [nature-service-plan.md](nature-service-plan.md) | **Historical decision/round log.** Current contracts live in the BE/FE source overviews |
| [frontend-gateway-consolidation.md](frontend-gateway-consolidation.md) | **Implemented.** One frontend gateway origin plus source-owned family prefixes |

## Current backend architecture

```txt
web client
  -> api-gateway
       /api/universe/* -> universe-service -> universe Neon database
       /api/nature/*   -> nature-service   -> nature Neon database
```

Universe and Nature are stateful full peers. The gateway owns the public HTTP
edge but no business logic. There is no auth-service today; the shared gateway
credential only prevents direct upstream bypass on public Render free URLs.

## The idea

Today Myunivokai paints two kinds of portrait: a solar system and a living
forest. The vision is a growing family of scene types, each a different
"medium" for the same person:

| Scene family | What the DNA drives |
| --- | --- |
| Universe (today) | Planets, orbits, palette, mood lighting |
| City | Skyline shape, district density, neon vs. lantern light, traffic pulse |
| Forest & mountains | Ridge silhouettes, tree density, fog banks, altitude |
| Rivers & streams | Meander curvature, flow speed, banks, stones |
| Lakes | Stillness, reflections, shore vegetation, weather |

Long-term, each scene family has an explicit backend owner and its own frontend
renderer. Source today does **not** generate one shared DNA record across
services: Universe produces `PersonalityDNA`, while Nature independently
produces `NatureDNA` from the same input shape. A future “portrait series” must
define a cross-service identity/DNA contract before claiming one DNA powers
many families.

## Why the current architecture already points there

Three rules are already enforced — every new family must keep honoring them:

1. **AI output is semantic.** Each peer's DNA contains meanings, trait scores,
   energy, and family entities — never visual numbers. The deterministic
   builder owns visual values.
2. **Determinism.** `seed.NewPRNG(seed)` drives every visual number inside
   safe bounds; the same seed always renders the same scene, and regenerating
   a variant costs zero AI calls.
3. **Mirrored parameters.** Tunables live on both sides and must stay in sync
   (today: `mood_scene_profile.go` ↔ `scene.ts` preview builder).

Concrete anchors in today's code:

| Piece | Where | Role in this plan |
| --- | --- | --- |
| `WorldConfigBuilder.Build(...)` | `internal/services/world_config_builder.go` | Already a pure function `(DNA, seed, variantNo, input) -> scene config`. It IS the first SceneComposer — it just doesn't know it yet. |
| Universe `WorldSceneConfig` envelope | `services/universe-service/internal/models/scene.go` | Has `schemaVersion` + `theme` but still lacks explicit `sceneType`; legacy FE handling relies on absence meaning solar-system. |
| Nature `ForestSceneConfig` envelope | `services/nature-service/internal/models/scene.go` | Emits `sceneType: "forest"` and schema 1.2. |
| FE renderer registry | `features/scene-renderers/registry.ts` | Already resolves `sceneType` first, then Universe theme; both renderers are still eagerly imported. |
| `SceneRendererProps` contract | `features/scene-renderers/types.ts` | Every renderer already implements one shared prop shape. |
| Shared 3D infra | `features/scene-renderers/shared/` | CameraRig, StarParticleField, PostEffects, CanvasLoader — scene-agnostic today, stays that way. |
| Scene config JSON Schemas | `contracts/schemas/world-scene-config.schema.json`, `contracts/scenes/forest-scene-config.schema.json` | Forest follows the family folder; Universe still needs migration/aliasing into the same structure. |

## Original three-phase proposal (historical, superseded for Nature)

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

- ~~**Do not split services before a second family exists in code.**~~
  **Superseded 2026-07-16** (owner decision): the second family is born as its
  own full peer service (`nature-service`), accepting the free-tier cold-start
  tradeoff consciously — see [nature-service-plan.md](nature-service-plan.md)
  section 4. The guardrail still applies to the next family: mountain/river/
  lake belongs in `nature-service` (D4); a non-natural family such as City
  needs an ownership ADR and does not get a new deploy automatically.
- **Keep provider calls behind each peer's AI interface.** AI produces semantic
  DNA only; seeded builders remain deterministic and provider-free.
- **Do not pretend the DNA schemas are shared.** They are family-specific in
  source. Reuse semantic concepts intentionally, and introduce a shared
  identity/portrait contract only when a real cross-family product story needs it.

## Source-grounded next upgrades

The prioritized acceptance criteria and tasks live in
[../user-stories/engineering-backlog.md](../user-stories/engineering-backlog.md).
The vision-level order is:

1. Prove the current four-service Render deployment with live smoke evidence.
2. Remove the known frontend dependency audit blocker by migrating Next.js
   through supported majors, without using `npm audit fix --force` blindly.
3. Make scene contracts executable across BE and FE: explicit Universe
   `sceneType`, per-family schemas, a real public Gateway OpenAPI contract,
   discriminated FE types, and CI validation.
4. Split scene-family renderer chunks and establish a measurable asset/frame
   budget, including a self-hosted Draco decoder and adaptive quality.
5. Add metrics/traces and shared gateway state only before horizontal scaling.
6. Evaluate a third scene family only after its ownership, asset budget, and
   user value have an approved story.

## Original decision points (historical)

This table records the first proposal. The dated owner-decision table below is
newer: D1 is deferred and D5 is obsolete under the peer-service architecture.

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | `scene_type` lives on world_variants (enables "portrait series": one world, variants in different mediums) vs. on worlds | **variants** |
| D2 | Language: Go for all scene services; Rust only when p95 compose > 50 ms or server-side asset baking appears | **Go now, Rust by trigger** |
| D3 | Gateway trigger | **Satisfied by the second public peer; Go gateway implemented without auth-service** |
| D4 | Forest/mountain/river/lake ownership | **one stateful `nature-service`, not a stateless composer** |
| D5 | Phase 2 ships with an embedded/remote per-family flag so extraction is reversible on the free tier | **yes** |

## Owner decisions (2026-07-16)

Recorded from the owner's direction, in two messages: (1) "the vision must
become microservices immediately"; forest scenery service; Go backend first;
gateway later; FE gets a universe/forest picker. (2) **Architecture
correction:** `nature-service` is a **full peer** of universe-service — same
mechanism (AI DNA → seeded builder → store → share), only the DNA layer
differs (landmarks instead of planets); universe-service is not modified at
all; no gateway and no FE work yet — just build the service. Full detail in
[nature-service-plan.md](nature-service-plan.md) section 1.

| # | Decision |
| --- | --- |
| D1 | **Deferred:** `scene_type` on world_variants is moot while each service owns its own worlds; revisit when a gateway or cross-service "portrait series" becomes real. |
| D2–D4 | Approved: Go for all scene services; gateway stays a Phase-3 item; forest/mountain/lake share the one `nature-service`. |
| D5 | **Obsolete:** with peer services there is no remote compose call to fall back from; rollback = don't deploy the nature service. |
| D6 | **Microservices immediately, as peers:** nature-service clones the universe-service mechanism end-to-end and never lives in the monolith. |
| D7 | Beauty-first asset strategy: curated CC0 GLB kits + art-direction pass (option B of [3d-development-limitations.md](../fe/3d-development-limitations.md)), all assets self-hosted. |
| D8 | Backend first: rounds N1–N5 before the frontend forest renderer (F1–F5). |
| D9 | **Gateway implemented (2026-07-17):** `/api/universe/*` and `/api/nature/*`; edge CORS/rate limit, shared upstream credential, aggregate readiness; user auth remains deferred. |
