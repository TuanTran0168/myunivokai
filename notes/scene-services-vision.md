# Scene services vision — from one universe to many worlds

Status: product direction, agreed 2026-07-03. Nothing here is scheduled yet;
this document exists so every future refactor decision can be checked against
the destination.

## The idea

Today Myunivokai paints one kind of portrait: a solar system. The vision is a
family of scene types, each a different "medium" for the same person:

| Scene family | Examples of what the DNA drives |
| --- | --- |
| Universe (today) | Planets, orbits, palette, mood lighting |
| City | Skyline shape, district density, neon vs. lantern light, traffic pulse |
| Forest & mountains | Ridge silhouettes, tree density, fog banks, altitude |
| Rivers & streams | Meander curvature, flow speed, banks, stones |
| Lakes | Stillness, reflections, shore vegetation, weather |

Long-term, each scene family is owned by its **own backend service**, and the
frontend has a **renderer per family**. One Personality DNA, many worlds.

## Why the current architecture already points there

Three existing rules make this expansion cheap *if we keep honoring them*:

1. **Personality DNA is theme-agnostic.** The AI produces semantics
   (archetype, trait scores, meanings, energy signature) — never visuals. A
   city composer and a lake composer can both consume the exact same DNA.
2. **Determinism.** Seed → scene config within safe bounds; the same seed
   always renders the same scene, with zero AI calls on regenerate. Every new
   scene family must be a pure function `(DNA, seed) -> scene config`.
3. **Mirrored parameters.** Whatever tunables a family has must exist on both
   sides and stay in sync (today: `mood_scene_profile.go` ↔ `scene.ts`). New
   families inherit this contract discipline.

The FE is already shaped for this: `scene-renderers/registry.ts` maps a theme
string from the BE to a renderer component, and
[fe/threejs-scene-architecture.md](fe/threejs-scene-architecture.md) documents
the "adding a new scene type" recipe. The missing half is the service side.

## Architecture evolution — three phases

### Phase 1 — theme registry inside universe-service (do this first)

A modular monolith: new scene families ship as new Go packages, not new
deployments.

- Extract a `SceneComposer` interface in the BE:
  `Compose(dna PersonalityDNA, seed WorldSeed) (SceneConfig, error)` — the
  existing solar-system builder becomes the first implementation.
- Add `sceneType` to the scene config envelope (alongside the existing
  `schemaVersion`), defaulting to `"solar-system"` for every stored world.
- A BE-side registry maps `sceneType -> SceneComposer`, symmetric with the FE
  renderer registry.
- Free-tier friendly: one deploy, one cold start, no service mesh.

### Phase 2 — extract scene services when a family gets heavy

- `services/scene-city-service`, `services/scene-nature-service`
  (forest/mountain/river/lake can start as one "nature" service — splitting
  too fine too early is operational pain, not architecture).
- The current universe-service evolves into the **world-service**: it owns the
  catalog — worlds, DNA generation, variants, share slugs — and calls the
  right scene service by `sceneType`.
- Scene services are **stateless pure functions** (DNA + seed in, scene config
  out): trivial to scale, cache, and deploy independently.
- Communication: plain HTTP/JSON first, request/response schemas as JSON
  Schema in `contracts/scenes/`; gRPC only if measurements demand it.
- Service discovery via config/env (`SCENE_CITY_SERVICE_URL=...`), never
  hardcoded.

### Phase 3 — full platform

- An API gateway takes over cross-cutting concerns (routing, rate limiting,
  auth once) — today's per-service rate-limit middleware migrates there.
- `services/auth-service` and `services/match-service` slot in as the repo
  layout already anticipates.
- If a scene family becomes expensive to compose, generation goes async
  (queue + polling/webhook) without changing the contracts.

## Contracts and compatibility

- Envelope: `{ schemaVersion, sceneType, seed, ...family params }`. One JSON
  Schema per family in `contracts/scenes/<sceneType>.schema.json`, validated
  on both sides.
- **Saved worlds must render forever.** The gallery keeps old configs
  indefinitely, so renderers are keyed by `sceneType` + `schemaVersion`;
  breaking changes mean a new schema version, never a mutation of stored
  configs.
- Additive changes (a new optional param with a deterministic default) do not
  bump the version.

## Frontend plan

- `registry.ts` grows one entry per family; each renderer is lazily imported
  (`next/dynamic`) so a visitor who only ever sees solar systems never
  downloads city geometry.
- `shared/` stays the home of cross-family infrastructure: CanvasLoader,
  camera rigs, quality profile, the seeded PRNG utilities.
- The create form's "World Style" evolves from style-within-solar-system into
  choosing (or letting the AI choose) the scene family itself.

## Product ideas to make it delightful

- **The AI picks your medium.** Map DNA archetypes to a default family — a
  contemplative archetype becomes a lake, an ambitious one a skyline, an
  adventurous one a mountain range. The user can always override; the
  suggestion is the charm.
- **Portrait series.** One DNA rendered as universe + city + lake, displayed
  side by side; the share page becomes a small gallery of the same soul in
  three mediums.
- **Cross-scene consistency.** The same palette and mood tokens drive every
  family, so your city glows in the same colors as your universe — instantly
  recognizable as *yours*.
- **Time and seasons as variant dimensions.** For terrestrial scenes,
  "regenerate variant" can also move time-of-day or season (dawn city, misty
  autumn mountain) — still seed-deterministic.
- **Sound signatures.** Derive a per-family ambient audio bed from
  `energySignature` (city hum, forest birdsong, lake water) — optional,
  muted by default.

## What NOT to do yet

- **Do not split services before a second family exists in code.** Phase 1's
  registry comes first; premature microservices multiply cold starts,
  deploys, and env management on the free tier for zero user value.
- **Do not put AI calls inside scene services.** AI stays in the
  world-service DNA step only — that is the cost-control and determinism
  boundary.
- **Do not fork the DNA schema per family.** DNA stays universal; only the
  composers differ. The moment a family "needs" its own DNA field, it is
  either a universal trait (add it for everyone) or a composer detail (derive
  it from the seed).

## Target repository shape (phase 2+)

```txt
services/
  world-service            <- today's universe-service: catalog, DNA, variants, share
  scene-city-service       <- pure composer: DNA + seed -> city scene config
  scene-nature-service     <- forest / mountain / river / lake composers
clients/web-client/src/features/scene-renderers/
  solar-system/  city/  nature/  shared/  registry.ts
contracts/scenes/
  solar-system.schema.json  city.schema.json  nature.schema.json
```
