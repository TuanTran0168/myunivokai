# FE Source Overview — clients/web-client

Next.js 14 App Router + TypeScript + Tailwind + React Three Fiber.
Every page is a client component because of WebGL and localStorage.

## Routes

| Route | File | Role |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing + create-universe form (combined). Submit -> POST /worlds -> redirect |
| `/worlds/[worldId]` | `src/app/worlds/[worldId]/page.tsx` | Dashboard: 3D canvas, planet panel, variants, publish/share, PNG export |
| `/gallery` | `src/app/gallery/page.tsx` | Worlds saved on this device (localStorage), loaded in parallel |
| `/share/worlds/[shareSlug]` | `src/app/share/worlds/[shareSlug]/page.tsx` | Public page, only safe data from the share API |

## The lib layer — every piece of data passes through here

- `lib/api.ts` — the single API client. The `normalize*` functions matter most:
  the BE returns `{ world, selectedVariant, variants }` (variant list at the
  response ROOT) and normalize maps everything onto the unified `World` /
  `WorldVariant` types. **The FE's worst historical bug lived here** (reading
  the wrong location sent the canvas into fallback mode). If a BE response
  shape changes, fix normalize first.
- `lib/types.ts` — mirrors the BE JSON contract
  (`services/universe-service/internal/models/scene.go`). Change them together.
- `lib/scene.ts` — safe scene-config readers (`planetsFromScene`,
  `paletteFromScene`, `backgroundColorFromScene`) + `randomFromSeed`
  (deterministic PRNG; `Math.random()` is forbidden in scene code).
- `lib/savedWorlds.ts` — localStorage key `myunivokai.savedWorldIds`. IDs are
  saved automatically on create and when opening a world page.
- `lib/exportImage.ts` — downloads the WebGL canvas as PNG
  (requires `preserveDrawingBuffer`, already set on the Canvas).

## The 3D part

Read [threejs-scene-architecture.md](threejs-scene-architecture.md) — it covers
three.js principles, the renderer registry, and how to add new scene types.

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
