# Frontend plan — scene-family renderers

> **Document status:** Active after source re-baseline
> **Last source review:** 2026-07-18

Part of the [vision folder](README.md). This plan describes the source that
exists now and the smallest upgrades needed next.

## Implemented baseline

- `WorldFamily = "universe" | "nature"` selects the public gateway prefix,
  API calls, gallery reference, world query parameter, share route, preview,
  and renderer.
- `registry.ts` resolves `sceneType` before Universe `theme`; Forest config
  therefore cannot fall into the solar-system renderer.
- The create form offers Universe and Forest and builds a family-specific,
  deterministic preview.
- Both share routes generate server-side metadata through the same one-gateway
  helper used by browser requests.
- Vitest covers the API normalizer, gateway URL mapping, preview builders, and
  deterministic procedural recipes.

## Gaps proven by source

### 1. The type model is not yet a discriminated union

`lib/types.ts` exposes one broad `SceneConfig`: almost every field is optional,
`sceneType` is `string`, and an index signature permits unknown keys. Universe
configs omit `sceneType` entirely while Forest emits `"forest"`. This keeps old
worlds rendering, but it cannot make invalid family/section combinations fail
at compile time.

Target, after the backend contract adds an explicit Universe discriminator:

```ts
type SolarSystemSceneConfig = SceneConfigBase & {
  sceneType: "solar-system";
  planets: PlanetSceneConfig[];
};

type ForestSceneConfig = SceneConfigBase & {
  sceneType: "forest";
  landmarks: ForestLandmarkConfig[];
};

type SceneConfig = SolarSystemSceneConfig | ForestSceneConfig;
```

Legacy configs without `sceneType` must normalize to `"solar-system"` before
renderer resolution. Do not delete compatibility for already stored worlds.

### 2. Scene renderers are eagerly bundled

`registry.ts` statically imports both `SolarSystemRenderer` and
`ForestRenderer`. The original lazy-registry goal was never implemented.
Each family should become a client-only dynamic chunk with the existing
`CanvasLoader` as fallback. Acceptance must be based on build output and a
browser network trace, not only a source-level dynamic import.

### 3. API responses are trusted at runtime

`lib/api.ts` parses JSON, normalizes through `any`, and casts payloads to the
requested generic. The defensive normalizer is valuable for legacy response
shapes, but malformed gateway/service output is not validated against a
runtime schema. Generate or hand-maintain one validated boundary; do not spread
schema checks through components.

### 4. Mobile quality is deliberately missing

The main canvas allows DPR up to 3 and source comments explicitly put weak
devices out of scope. There is no `PerformanceMonitor`, adaptive DPR,
family-level quality profile, LOD policy, or WebGL error boundary. Add measured
tiers before adding another heavy scene family.

### 5. Asset delivery has two concrete gaps

- Nature's Draco-compressed GLBs use Drei's default Google-hosted decoder
  because no local decoder path is configured. This conflicts with the repo's
  self-hosted-runtime policy.
- Catalog tests verify deterministic selection, but do not verify that every
  referenced model/HDRI/texture exists, has attribution metadata, and remains
  below its budget.

## Next sequence

1. Migrate Next.js 14 through supported majors and make the production audit
   gate green.
2. Harden the contract from BE schema to FE discriminated union plus runtime
   validation.
3. Lazy-load renderer families and publish per-family JS/asset budgets.
4. Self-host the Draco decoder and add catalog/file/license/budget tests.
5. Add adaptive DPR/LOD/effect tiers and a recoverable WebGL fallback.

Given/When/Then acceptance and branch-sized tasks are maintained in
[../user-stories/engineering-backlog.md](../user-stories/engineering-backlog.md).
