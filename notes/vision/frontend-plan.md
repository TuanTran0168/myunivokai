# Frontend plan — sceneType-first renderers

Part of the [vision folder](README.md).

## Types — discriminated union on `sceneType`

`lib/types.ts` evolves (additive; today's `SceneConfig` becomes the
solar-system member):

```ts
type SceneConfigBase = { schemaVersion: string; sceneType: SceneType; theme?: string; palette: Palette; camera: CameraConfig; postFX: PostFXConfig; };
type SolarSystemSceneConfig = SceneConfigBase & { sceneType: "solar-system"; core: CoreConfig; planets: PlanetSceneConfig[]; particles: ParticleConfig; };
type CitySceneConfig       = SceneConfigBase & { sceneType: "city"; skyline: SkylineConfig; districts: DistrictConfig[]; traffic: TrafficConfig; };
type SceneConfig = SolarSystemSceneConfig | CitySceneConfig; // grows per family
```

Configs stored before `sceneType` existed normalize to `"solar-system"` in
`normalizeVariant` — the same defensive-normalization spot that exists today.

## Registry — sceneType-first, lazily loaded

`registry.ts` becomes two-level and dynamic:

```ts
const SCENE_FAMILY_REGISTRY: Record<SceneType, () => Promise<SceneRendererComponent>> = {
  "solar-system": () => import("./solar-system/SolarSystemRenderer").then(m => m.SolarSystemRenderer),
  city:           () => import("./city/CityRenderer").then(m => m.CityRenderer),
};
```

- `next/dynamic` + the existing `CanvasLoader` torus rings as the Suspense
  fallback — a visitor who only ever sees solar systems never downloads city
  geometry or textures (three.js scene code is the heaviest thing we ship).
- `resolveSceneRenderer(theme)` keeps working for old data: unknown/missing
  `sceneType` → solar-system; `theme` keeps selecting style within a family.
- `SceneRendererProps` stays the contract; the planet-focused parts
  (`selectedPlanetKey`, `onSelectPlanet`) generalize to "points of interest"
  (a city's districts, a lake's landmarks) under the same prop names first —
  a rename is a separate, mechanical refactor later.

## Mirror discipline at family scale

Today one pair must stay in sync (`mood_scene_profile.go` ↔ `scene.ts`).
With N families that discipline needs structure, not memory:

- BE: `internal/scenes/<family>/<family>_scene_profile.go`
- FE: `src/features/scene-renderers/<family>/sceneProfile.ts`
- Each pair carries a `PROFILE_VERSION` constant asserted equal by one unit
  test on each side — drift fails CI instead of shipping a mismatched preview.
- Longer term (deferred): generate TS types from
  `contracts/scenes/*.schema.json` (`json-schema-to-typescript`) so the
  envelope cannot drift at all.

## Create form and preview

- "World Style" grows into a **scene family picker** (family cards, then the
  existing style chips within the family). Default stays solar-system.
- Or the charming option: the AI picks the medium from the DNA (archetype →
  family mapping in the DNA prompt's visualHints), user can override. Both
  fit the `preferredSceneType` API field from the
  [backend plan](backend-plan.md).
- Live preview: each family ships a `buildPreviewSceneConfig` sibling — the
  same mirror rule as above; the preview must visibly react to mood/colors
  exactly like the real composer.

## Assets

- Textures per family under `public/textures/<family>/`, each with its own
  `ATTRIBUTION.md` (the solar-system one already sets the pattern).
- Budget per family bundle: ≤ 300 KB JS (gzip) + lazy textures; enforced by
  reviewing `next build` output per route until we automate it.
