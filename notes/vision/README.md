# Vision — Myunivokai as a multi-scene platform

Status: **active, gateway amendment implemented** (2026-07-17). The original
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
| [frontend-plan.md](frontend-plan.md) | sceneType-first lazy renderer registry, type unions, mirror discipline, create-form evolution |
| [deployment.md](deployment.md) | Current three-service Render blueprint, rollout, free-tier behavior, observability |
| [contracts-and-roadmap.md](contracts-and-roadmap.md) | Schema versioning rules, phased roadmap with triggers, risk table |
| [visual-diversity.md](visual-diversity.md) | Direction for more visual diversity: 5-tier ladder (data knobs → catalogs → procedural → rare features → new families), guardrails, suggested order |
| [nature-service-plan.md](nature-service-plan.md) | **The active track.** `nature-service` — a full peer of universe-service (same mechanism, forest DNA): forest with wind, four seasons, weather, wildlife; config contract, asset strategy, rounds N1–N5 / F1–F5 |
| [frontend-gateway-consolidation.md](frontend-gateway-consolidation.md) | **Proposed, not implemented.** Collapse the FE's two family base-URL env vars into one gateway URL + code-computed path prefix |

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
  section 4. The guardrail still applies to any *third* family: it joins
  nature-service (D4), it does not get its own deploy.
- **Keep provider calls behind each peer's AI interface.** AI produces semantic
  DNA only; seeded builders remain deterministic and provider-free.
- **Do not fork the DNA schema per family.** DNA stays universal; only the
  composers differ.

## Decision points for approval

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
