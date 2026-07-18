# FE Source Overview — clients/web-client

Next.js 14 App Router + TypeScript + Tailwind + React Three Fiber.
Every page is a client component because of WebGL and localStorage.

## World families — one source, two scene worlds

The client renders two scene families from the **same source**:
`WorldFamily = "universe" | "nature"`. The create form (`/`) has a Universe /
Forest picker; each family talks to its own backend base URL
(`NEXT_PUBLIC_API_BASE_URL` vs `NEXT_PUBLIC_NATURE_API_BASE_URL`). The family is
plumbed through `api.ts`, gallery localStorage ids, the `?family=` query param,
and a twin nature share route. See
[forest-render-mechanism.md](forest-render-mechanism.md) for the forest renderer
itself.

## Routes

| Route | File | Role |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Landing + create form (combined) with the **Universe/Forest family picker**. Submit -> POST /worlds (chosen family) -> redirect |
| `/worlds/[worldId]` | `src/app/worlds/[worldId]/page.tsx` | Dashboard: 3D canvas, POI panel, variants, publish/share, PNG export. Reads `?family=` to pick the API + renderer |
| `/gallery` | `src/app/gallery/page.tsx` | Worlds saved on this device (localStorage), family-aware, loaded in parallel |
| `/share/worlds/[shareSlug]` | `src/app/share/worlds/[shareSlug]/page.tsx` | Public **universe** share page |
| `/nature/share/worlds/[shareSlug]` | `src/app/nature/share/worlds/[shareSlug]/page.tsx` | Public **nature** share page (twin route; nature-service prints share URLs with the `/nature` prefix) |

## The lib layer — every piece of data passes through here

- `lib/api.ts` — the single API client, now **family-aware**: `request(family,
  path, init)` picks the base URL by `WorldFamily`
  (`API_BASE_URLS_BY_FAMILY`), and every method takes a family. The `normalize*`
  functions matter most: the BE returns `{ world, selectedVariant, variants }`
  (variant list at the response ROOT) and normalize maps everything onto the
  unified `World` / `WorldVariant` types. **The FE's worst historical bug lived
  here** (reading the wrong location sent the canvas into fallback mode). If a BE
  response shape changes, fix normalize first.
- `lib/types.ts` — mirrors the BE JSON contract. `WorldSceneConfig` (universe,
  `services/universe-service/internal/models/scene.go`) **and** the forest scene
  sections + `sceneType`. Change them together with the matching BE model.
- `lib/scene.ts` — safe scene-config readers (`planetsFromScene`,
  `paletteFromScene`, `backgroundColorFromScene`) + `randomFromSeed`
  (deterministic PRNG; `Math.random()` is forbidden in scene code). Also
  `FOREST_SCENE_TYPE` / `isForestScene` and `pointsOfInterestFromScene` (adapts
  forest landmarks into the shared POI/`PlanetSceneConfig` shape so HUD, hover
  and CameraRig stay family-agnostic).
- `lib/forestScene.ts` — **deterministic preview mirror** of the Go forest
  builder (`forest_scene_profile.go` + `forest_config_builder.go`): same tables,
  same per-section PRNG streams, same draw order (xorshift mirror → plausible,
  not byte-equal). Keep it in sync on every tuning change. Covered by
  `forestScene.test.ts` (determinism + contract-bounds).
- `lib/worldRoutes.ts` — family-aware path/query helpers (`worldPagePath`,
  `sharePagePath`, `worldFamilyFromQueryValue`, `WORLD_FAMILY_QUERY_PARAMETER`).
- `lib/savedWorlds.ts` — localStorage key `myunivokai.savedWorldIds`, now
  `SavedWorldReference { worldIdentifier, family }` (legacy plain-string entries
  read as universe). IDs saved automatically on create and when opening a world.
- `lib/exportImage.ts` — downloads the WebGL canvas as PNG
  (requires `preserveDrawingBuffer`, already set on the Canvas).

## The 3D part

- [threejs-scene-architecture.md](threejs-scene-architecture.md) — three.js
  principles, the **sceneType-first** renderer registry, and how to add a scene
  type.
- [universe-render-mechanism.md](universe-render-mechanism.md) — how the universe
  is drawn (4 model layers, texture/GLB pipelines, determinism).
- [forest-render-mechanism.md](forest-render-mechanism.md) — the forest/nature
  renderer: instanced + animated GLBs, seasonal foliage recolor, bird animation
  gotchas, the horizon technique, and the **Sketchfab asset constraint**.

## State

No Redux/Zustand. Each page owns its state with `useState`/`useMemo`; planet
selection syncs between canvas and panel via props (`selectedPlanetKey` +
`onSelectPlanet`). Reach for a store only if state starts spanning pages.

## Required checks before committing

```bash
cd clients/web-client
npm run typecheck
npm run lint
npm run build
```

For integrated local development, root `docker-compose-local.yml` builds this
client with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8082/api/universe` and
starts it after the API Gateway is healthy. The default VS Code build task
starts that full stack.
