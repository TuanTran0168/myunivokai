# Contracts, roadmap, and risks

Part of the [vision folder](README.md).

## Contracts and compatibility

- Envelope: `{ schemaVersion, sceneType, theme, palette, camera, postFX, ...family fields }`.
- One schema per family: `contracts/scenes/<sceneType>.schema.json`; the
  compose request/response schemas live beside them.
- **Saved worlds must render forever.** Renderers are keyed by
  `sceneType` + `schemaVersion`; stored configs are never mutated.
  - Additive change (new optional field with deterministic default): no bump.
  - Breaking change: new `schemaVersion`; the renderer keeps a reader for the
    old version (or a pure upgrade function old→new, tested by fixture).
- Golden fixtures per family per schemaVersion in the composer's testdata are
  the compatibility contract in executable form.

## Roadmap

| Step | Branch | Content | Done when |
| --- | --- | --- | --- |
| 1a | `feat/be/scene-composer-registry` | `internal/scenes` package, SceneComposer + Registry, solar-system composer moved, `sceneType` in envelope + migration, API fields | Golden test proves byte-identical solar-system output; all existing tests green |
| 1b | `feat/fe/scene-type-registry` | sceneType-first lazy registry, normalize legacy configs, types union | Old worlds render unchanged; bundle for `/` unchanged |
| 1c | `feat/fe-be/scene-family-city` | First real second family, in the monolith: city composer + CityRenderer MVP + profile mirror pair + fixtures | Create form offers City; a city world survives save/share/gallery |
| 1d | (repeat 1c) | nature family (forest/mountain/river/lake as themes) | same bar |
| 2 | `feat/be/extract-scene-services` | Extract city+nature into services, compose contract, embedded/remote flag, blueprint entries | Prod works in remote mode; rollback = flip env to embedded |
| 3 | `feat/be/api-gateway` | Go gateway (see [api-gateway.md](api-gateway.md)), middleware moves up, services shed CORS/rate-limit | One public origin; statusz aggregates; FE needs zero changes |

## Phase triggers (approve as policy)

- **Enter Phase 2** only when BOTH: two+ families live in the monolith AND
  (a family's deploy cadence conflicts with world-service, or compose load is
  measurable). Not before.
- **Enter Phase 3** when auth-service (or any second public service) is real.
- **Rust port** of a scene service only on the trigger in the
  [backend plan](backend-plan.md): p95 compose > 50 ms or baked binary assets.

## Risks

| Risk | Mitigation |
| --- | --- |
| Refactor 1a silently changes stored-world rendering | Golden-snapshot test: fixed DNA+seed fixture must be byte-identical before/after |
| FE/BE profile drift multiplies with families | PROFILE_VERSION pair test per family, CI-enforced ([frontend-plan.md](frontend-plan.md)) |
| Free-tier chained cold starts | Phase gating + embedded/remote flag ([deployment.md](deployment.md)) — extraction is reversible |
| Internal endpoints publicly reachable on free tier | Shared-secret middleware; endpoints are pure + stateless; upgrade to private services when paid |
| Two-language stack fragments the team | Rust only behind a measured trigger; the contract keeps it swappable |
| Registry key confusion (theme × sceneType) | `sceneType` = family (routing), `theme` = style within family (composer input) — written into both registries' doc comments |
