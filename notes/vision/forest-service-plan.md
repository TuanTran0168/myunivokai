# Forest family — `scene-nature-service` plan (v1)

Part of the [vision folder](README.md). Written 2026-07-16 against commit
`392f785` (staging = main, schema 1.2 live in production).

Status: **approved direction**. Owner decision 2026-07-16: *"the vision must
become microservices immediately"* — the nature family is born as its own Go
service instead of waiting for the Phase-1 → Phase-2 trigger. Backend first;
the frontend forest renderer comes after the service is real. This document is
the working context for every future session on this track — it is deliberately
self-contained.

---

## Tóm tắt cho owner (VI)

- **Quyết định:** tách microservice **ngay** — service Go mới
  `services/scene-nature-service` (stateless, chỉ compose config), universe-service
  giữ nguyên vai trò facade (DB + AI + worlds/variants/share). Gateway vẫn để
  sau (Phase 3, đã có thiết kế trong [api-gateway.md](api-gateway.md)).
- **Sản phẩm:** cảnh **rừng cây** là "chân dung tính cách" thứ hai — gió thổi
  cây đung đưa, **4 mùa xuân/hạ/thu/đông + giao mùa**, thời tiết **mưa/nắng**,
  **thú đi lại, chim bay**, **thu lá rụng, đông tuyết phủ**. Mỗi DNA planet
  thành một **landmark** trong rừng (cây thiêng, hồ nước, tảng đá, bụi hoa…) —
  click-to-focus đọc ý nghĩa, giữ đúng UX hiện tại.
- **Độ đẹp là ưu tiên #1:** dùng **model GLB CC0 chất lượng trên mạng**
  (Quaternius/Kenney/Poly Haven — hướng B trong
  [3d-development-limitations.md](../3d-development-limitations.md)), tự host,
  nén Draco, HDRI lighting, golden-hour mặc định, grade màu theo mùa.
- **Thứ tự làm:** N1 scaffold + deploy service rỗng → N2 composer lõi
  (mùa/ánh sáng/địa hình/cây/landmarks) → N3 thời tiết + thú + hạt (lá/tuyết/
  đom đóm) → N4 nối vào universe-service (migration cột `scene_type`, thêm
  `preferredSceneType`) → N5 curate + tối ưu asset. FE làm sau (F1–F5), trong
  đó F5 có **picker chọn "Vũ trụ / Rừng cây"** trên create form.
- **An toàn prod:** universe-service chỉ nhận thay đổi cộng-thêm (1 migration
  `ADD COLUMN ... DEFAULT 'solar-system'`, JSONB cũ không bị đụng); đường
  solar-system không bao giờ gọi HTTP ra ngoài; forest lỗi → 503 thử lại, không
  bao giờ 500.

---

## 1. Owner decisions — 2026-07-16

| # | Decision | Detail |
| --- | --- | --- |
| D1–D4 | **Approved** as recommended | `scene_type` on `world_variants`; Go for all scene services; gateway stays a Phase-3 item ("xa sau này có gateway"); forest/mountain/river/lake share **one** `scene-nature-service`. |
| D5 | **Amended** | No embedded/remote flag for the nature family. Embedded mode would force cross-module imports and a repo-root Docker build context. Rollback lever instead: `SUPPORTED_SCENE_TYPES` env in universe-service — remove `forest` and the family is off instantly; the universe path is untouched either way. |
| D6 | **Microservices immediately** | Supersedes the "do not split before a second family exists in code" guardrail and the Phase-2 entry trigger — for the nature family only. The nature family never lives in the monolith; universe-service still gains the small composer registry it needs to dispatch (section 7). |
| D7 | **Beauty first** | Asset strategy = option **B** of the limitations memo: curated CC0 GLB kits + one art-direction pass (layout grammar, lighting presets, per-season grade). All assets self-hosted (no external CDN at runtime). |
| D8 | **Backend first** | Rounds N1–N5 (Go service + integration) come before F1–F5 (frontend renderer). The service is testable end-to-end with fixtures and `curl` before any pixel is drawn. |

## 2. Where the code stands today (anchors for a fresh session)

| Piece | Where | Relevance |
| --- | --- | --- |
| Deployed API | `services/universe-service` — chi + zerolog + pgx (Neon) + goose migrations (`migrations/000001_init.sql`, run by `cmd/migrate` when `RUN_MIGRATIONS_ON_START=true`) | The facade. Owns worlds, DNA (only AI caller), variants, share slugs, DB. Live at myunivokai.onrender.com. |
| Scene config builder | `internal/services/world_config_builder.go` (+ `mood_scene_profile.go`, `sky_scene_profile.go`, `diversity_scene_profile.go`) | Pure `(DNA, seed, variantNo, input) → WorldSceneConfig`, schemaVersion **1.2**. The pattern the forest composer copies: dedicated PRNG stream per section, fixed draw order, bounds as named constants. |
| Seeded PRNG | `internal/seed/prng.go` — FNV-64a → `math/rand` | Copied verbatim into the new service (byte-identical file, mirror header comment). |
| Envelope | `internal/models/scene.go` — `WorldSceneConfig` | Gains `sceneType` (omitempty) in round N4. |
| FE renderer registry | `clients/web-client/src/features/scene-renderers/registry.ts` | Today keyed by `theme` (5 themes → SolarSystemRenderer). Becomes sceneType-first in F1 ([frontend-plan.md](frontend-plan.md)). |
| FE preview mirror | `clients/web-client/src/lib/scene.ts` | `buildPreviewSceneConfig` mirrors the BE builder. Forest gets a sibling in F5. |
| Contracts | `contracts/schemas/*.json` | Forest schema lands in `contracts/scenes/` (new folder per the vision). |
| Deploy | `render.yaml` (one service: `myunivokai-api`), FE on Vercel | Grows a second service entry in N1. |
| CI | `.github/workflows/ci.yml` — `backend-checks` + `frontend-checks` | Grows `nature-service-checks` in N1. |
| Create form input | `models.WorldInput` — `mood` (`focused/dreamy/energetic/reflective`), `favoriteColors`, `preferredWorldStyle`, interests/traits/goal | The semantic inputs the forest composer maps to season/weather/wildlife. |
| Personality DNA | `models.PersonalityDNA` — archetype, traitScores (creativity/discipline/curiosity/energy/focus), energySignature, `planets[]` (key/name/type/meaning/energy), visualHints | Theme-agnostic by rule #1 — the forest consumes it unchanged. |

## 3. The product idea — a forest as a personality portrait

The visitor lands in a clearing at golden hour. Trees sway in the wind, leaves
rustle. Depending on the person: cherry blossoms drift in a spring shower, or
fireflies blink in a summer dusk, or red maples shed leaves into an autumn
mist, or snow settles silently on pines. A deer crosses the path; a flock of
birds arcs over the treeline. Scattered around the clearing are **landmarks —
one per DNA planet**: the heart-tree, a standing stone, a still pond, a flower
patch, a fallen mossy log, a small lantern shrine. Click one and the camera
glides to it and reads its meaning — exactly the planet interaction the
universe already has, in a different medium.

### Semantic mapping (DNA → forest), all seed-deterministic

| Input | Drives | How |
| --- | --- | --- |
| `mood` | **Season bias** + wind + wildlife density | focused → winter-leaning (crisp, still, evergreen); dreamy → spring-leaning (blossom, soft light); energetic → summer-leaning (lush, breezy, most wildlife); reflective → autumn-leaning (golden, misty, falling leaves). Bias means weighted PRNG draw (~55% the leaning season, rest spread), never a hard mapping — variety survives. |
| Seed roll | **Giao mùa** (transition) | ~20% of worlds get `season.blend` toward an adjacent season (e.g. autumn → winter at 0.4: some leaves left + first snow patches). |
| `favoriteColors` | Palette accents | Flower patches, blossom tint, lantern glow, fireflies — primary/secondary flow into `palette` exactly like today. |
| `traitScores.energy` + `energySignature.intensity` | Wind strength, animal count, bird flocks | Higher energy → livelier forest. |
| `planets[]` (key/name/meaning/energy) | **Landmarks** | Same count, same keys → click-to-focus reuses the existing POI flow (`selectedPlanetKey` generalizes per [frontend-plan.md](frontend-plan.md)). Kind chosen per planet from a deterministic table (section 5). |
| `visualHints.theme` | Kept in envelope | Style-within-family hook for later; forest v1 grades by **season**, not theme. |
| Variant regenerate | New seed → possibly new season/weather | "Time and seasons as variant dimensions" from the vision README, for free. |

## 4. Architecture v1 — the immediate split

```txt
 Vercel (web-client)
        │  public REST (unchanged)
        ▼
 universe-service  ──────────────────────────  Neon Postgres
 (facade: worlds, DNA/AI, variants,            (only DB owner,
  share, rate limit, CORS, swagger)             only migration runner)
        │
        │  POST /internal/v1/compose        ┌──────────────────────────┐
        │  X-Internal-Key, X-Request-Id     │  scene-nature-service    │
        └───────────────────────────────────►  stateless Go composer   │
           only when sceneType != solar-system  (forest today;         │
                                             │   mountain/lake later)  │
                                             └──────────────────────────┘
 (Phase 3, unchanged trigger: api-gateway in front of both — see api-gateway.md)
```

Rules that keep it safe:

- **Solar-system never crosses the network.** Its composer stays in-process in
  universe-service; the remote path exists only for scene types the facade does
  not implement. A dead nature service cannot affect universe creation.
- **scene-nature-service is stateless.** No `DATABASE_URL`, no AI keys, no
  migrations. Its whole config is a port, a log level, and the internal key.
  Killing/redeploying it loses nothing.
- **AI stays in universe-service** (the DNA step) — cost-control and
  determinism boundary, unchanged.
- Free tier has no private services: the compose endpoint is public-URL but
  screened by `X-Internal-Key` (constant-time compare, 401 envelope). It is
  pure math, mutates nothing, holds no secrets — honest screening is enough
  until paid networking.
- Cold starts: a first forest request may hit a sleeping nature service.
  Answer = the existing 503 taxonomy (`SCENE_UNAVAILABLE` + `Retry-After`),
  FE shows "the forest is waking up — try again"; universe worlds are never
  blocked. No keep-alive hacks.

## 5. `ForestSceneConfig` v1 — draft contract

Envelope fields (`schemaVersion: "1.0"`, `sceneType: "forest"`, sceneName,
archetype, quote, theme, palette, camera, postFX incl. `grade`, hud) keep the
same shapes as the universe config. Renderers are keyed by
`(sceneType, schemaVersion)` per [contracts-and-roadmap.md](contracts-and-roadmap.md).

**Size discipline:** the stored config stays small (~3–4 KB JSONB). Only
semantic and hero placements are stored (landmarks). Mass scatter — hundreds
of trees, grass tufts, leaf particles, bird paths — is computed **frontend-side
from seeds embedded in the config**, exactly like `MilkyWayConfig.Seed` works
today. BE decides *what and how much*; FE derives *where* deterministically.

Draft example (values illustrative; bounds are the contract):

```jsonc
{
  "schemaVersion": "1.0",
  "sceneType": "forest",
  "sceneName": "Amberfall Hollow",
  "archetype": "The Quiet Cartographer",
  "quote": "...",
  "theme": "aurora",
  "palette": { "background": "#0b0e09", "primary": "#8B5CF6", "secondary": "#06B6D4", "accent": "#FACC15", "gradient": ["#8B5CF6", "#06B6D4", "#FACC15"] },

  "season": {
    "kind": "autumn",                        // spring | summer | autumn | winter
    "blendTowardKind": "winter",             // optional — giao mùa
    "blendAmount": 0.35,                     // 0..1, 0 = pure season
    "foliageColors": ["#C2571B", "#D98E2B", "#8F3B1B"],  // per-season table + palette accent
    "groundKind": "leafLitter"               // grass | leafLitter | snow | moss
  },

  "lighting": {
    "timeOfDay": "goldenHour",               // day | goldenHour | dusk
    "sunElevationRadians": 0.42,
    "sunAzimuthRadians": 2.1,
    "sunColor": "#FFD9A0",
    "ambientColor": "#7C8BA6",
    "hdriKey": "meadow-golden-1k",           // from the asset catalog
    "exposure": 1.05,
    "fogColor": "#C9B79C",
    "fogDensity": 0.018                      // autumn mist; 0 = none
  },

  "terrain": {
    "placementSeed": "abc123-forest-terrain",
    "clearingRadius": 9.5,                   // hero clearing at origin
    "treelineRadius": 42,                    // beyond this, billboard/fog fade
    "hillAmplitude": 1.6,
    "hillFrequency": 0.05,
    "pathEnabled": true,
    "rockCount": 14,
    "grassTuftCountDesktop": 900,
    "grassTuftCountMobile": 350
  },

  "trees": {
    "placementSeed": "abc123-forest-trees",
    "countDesktop": 220,
    "countMobile": 90,
    "speciesMix": [                          // model keys from the asset catalog
      { "modelKey": "tree-birch", "weight": 0.4 },
      { "modelKey": "tree-oak", "weight": 0.35 },
      { "modelKey": "tree-pine", "weight": 0.15 },
      { "modelKey": "tree-dead", "weight": 0.1 }
    ],
    "scaleMin": 0.8,
    "scaleMax": 1.45,
    "foliageTintStrength": 0.7,              // how hard season.foliageColors tint the leaves
    "windStrength": 0.55,                    // 0..1 → shader sway amplitude
    "windDirectionRadians": 1.9,
    "windGustFrequency": 0.35                // gust cycles per second (slow)
  },

  "weather": {
    "kind": "rain",                          // clear | sunRays | overcast | rain | snow
    "intensity": 0.6,                        // 0..1 scales particle counts + audio later
    "cloudCoverage": 0.7,                    // 0..1
    "rainDropCountDesktop": 5200,
    "rainDropCountMobile": 1600,
    "snowflakeCountDesktop": 0,
    "snowflakeCountMobile": 0
  },

  "wildlife": {
    "groundAnimals": [
      { "modelKey": "animal-deer", "count": 2, "pathSeed": "abc123-forest-animal-0", "walkSpeed": 0.5, "scale": 1.0 },
      { "modelKey": "animal-fox",  "count": 1, "pathSeed": "abc123-forest-animal-1", "walkSpeed": 0.7, "scale": 0.85 }
    ],
    "birdFlocks": [
      { "modelKey": "bird-forest", "birdCount": 5, "pathSeed": "abc123-forest-birds-0",
        "altitudeMin": 14, "altitudeMax": 22, "flightSpeed": 0.6, "pattern": "circling" }  // circling | crossing
    ]
  },

  "ambientParticles": {
    "fallingLeafCount": 260,                 // autumn / autumn-blend only, colors = season.foliageColors
    "blossomPetalCount": 0,                  // spring only
    "fireflyCount": 0,                       // summer dusk only
    "snowDustCount": 0                       // winter ground-glitter, separate from weather snowfall
  },

  "landmarks": [                             // one per DNA planet — the POI layer
    { "key": "planet-1", "name": "Elder Oak", "meaning": "...", "kind": "heartTree",
      "angleRadians": 0.6, "radiusFromCenter": 6.8, "accentColor": "#8B5CF6", "energy": 86 },
    { "key": "planet-2", "name": "Still Pond", "meaning": "...", "kind": "pond",
      "angleRadians": 2.7, "radiusFromCenter": 7.9, "accentColor": "#06B6D4", "energy": 64 }
    // kinds: heartTree | standingStone | pond | flowerPatch | fallenLog | lanternShrine
  ],

  "camera": { "distance": 16, "fov": 50 },
  "postFX": {
    "bloomIntensity": 0.5,
    "grade": { "hueRadians": -0.02, "saturation": 0.15, "brightness": 0.02, "contrast": 0.08 }  // per-SEASON table
  },
  "hud": { "showTraitBars": true, "showLabels": true },

  "assets": {
    "catalogVersion": "nature-1",            // pins which catalog resolved the keys
    "modelKeys": ["tree-birch", "tree-oak", "tree-pine", "tree-dead", "animal-deer", "animal-fox", "bird-forest", "rock-mossy", "landmark-lantern"],
    "hdriKey": "meadow-golden-1k"
  }
}
```

### PRNG streams (BE composer) — same discipline as schema 1.2

Every section draws from its own stream; **all draws always happen, in fixed
order, even when a gate disables the feature** — so adding features later never
shifts existing draws. Stream labels are prefixed `-forest-` so future
mountain/lake composers in the same service can never collide.

| Stream | Draws (fixed order) |
| --- | --- |
| `seed + "-forest-season"` | season roll (mood-weighted), transition roll, blend amount, foliage color picks |
| `seed + "-forest-lighting"` | timeOfDay roll, sun elevation, azimuth, exposure, fog roll, fog density |
| `seed + "-forest-terrain"` | clearing radius, hill amplitude, hill frequency, rock count, grass counts, path roll |
| `seed + "-forest-trees"` | count, species-mix rolls, scale range, tint strength, wind strength, direction, gust frequency |
| `seed + "-forest-weather"` | kind roll (season-constrained), intensity, cloud coverage (particle counts derive from intensity — no extra draws) |
| `seed + "-forest-wildlife"` | species count, per-slot species/count/speed/scale (fixed max slots: always draw for 3 ground slots + 2 flock slots, gate after) |
| `seed + "-forest-landmarks"` | per planet: kind roll, angle jitter, radius, (positions stored — landmarks are the hero layer) |

FE-side scatter streams (renderer, later — fixed labels documented now):
`{seed}-forest-tree-placement`, `-forest-grass`, `-forest-rocks`,
`-forest-animal-{index}` (path control points), `-forest-birds-{index}`,
`-forest-leaves`, `-forest-petals`, `-forest-fireflies`.

### Season → weather / species / grade tables (named constants in the profile)

| Season | Allowed weather | Tree bias | Wildlife | Ambient | Grade intent |
| --- | --- | --- | --- | --- | --- |
| spring | clear, sunRays, overcast, rain | birch/oak + blossom tint | rabbits, deer, most birds | blossom petals | fresh, slightly bright |
| summer | clear, sunRays, rain, overcast | oak/birch deep green | deer, fox, boar, birds | fireflies at dusk, dust motes in sun rays | warm, saturated |
| autumn | clear, sunRays, overcast, rain | oak/maple-tinted + dead | deer, fox, boar, fewer birds | **falling leaves**, mist | golden, +saturation, +contrast |
| winter | clear, overcast, **snow** | pine + dead + snow-capped variants | wolf/fox/deer sparse, rare birds | **snowfall** + ground snow, snow dust | desaturated, cool, crisp |

Transition (`blendTowardKind` + `blendAmount`) mixes the two adjacent columns:
FE lerps ground/tint/particle counts; weather comes from the dominant season.

## 6. Beauty-first asset strategy (độ đẹp / độ sắc nét)

Per the limitations memo: the quality ceiling is **assets + art direction**,
not AI and not code. This family budgets for it from day one (option B).

### Curated source shortlist (verify licenses per item during N5)

| Pack | License | Gives us |
| --- | --- | --- |
| Quaternius — Ultimate Nature / Stylized Nature MegaKit (quaternius.com) | CC0 | Trees (incl. **snow-capped winter variants**), rocks, stumps, logs, grass, flowers, mushrooms — one coherent stylized look |
| Quaternius — Ultimate Animated Animals | CC0 | Rigged deer, fox, wolf, rabbit… with idle/walk clips — exactly the "động vật đi qua đi lại" requirement |
| Kenney — Nature Kit (kenney.nl) | CC0 | Prop fallback, path tiles |
| Poly Haven (polyhaven.com) | CC0 | HDRIs (forest/meadow, 1–2K) for lighting + ground textures (grass, leaf litter, snow) |
| Birds (flapping, low-poly) | **TBD in N5** | Verify a CC0 animated bird (Quaternius packs first; else a CC-BY model with in-app attribution) |

Rules: CC0 preferred; CC-BY acceptable **with** an entry in
`public/models/nature/ATTRIBUTION.md` + the credits note. **Never hotlink** —
every asset self-hosted (deploy environments block external CDNs; already a
hard rule for HDR). One visual style per family — do not mix realistic and
stylized packs in the same scene.

### Pipeline (N5)

```txt
download → npx @gltf-transform/cli optimize in.glb out.glb
             --compress draco --texture-compress webp --texture-size 1024
         → clients/web-client/public/models/nature/<key>.glb
         → catalog entry: { key, path, license, source, animationClipNames, approxKB }
```

- The **asset catalog** is the bridge: a versioned Go table in the service
  (`internal/assets/catalog.go`, `catalogVersion: "nature-1"`) listing every
  model/texture/HDRI key the composer may emit. A frontend vitest asserts every
  catalog key resolves to a real file under `public/` (same pattern as
  `planetTextureCatalog.test.ts`). Composer tests assert it never emits a key
  outside the catalog.
- Budgets: single GLB ≤ 500 KB post-Draco (Quaternius models are typically
  ≪ 100 KB); HDRI ≤ 2 MB; forest route lazy payload ≤ 8 MB total; forest JS
  chunk ≤ 300 KB gzip (per [frontend-plan.md](frontend-plan.md)).
- Sharpness levers (F-rounds): correct sRGB pipeline, anisotropy on ground
  textures, DPR cap 2, per-tier shadow map sizes, ACES tone mapping, WebP 1K
  textures now / KTX2 later if banding appears.

## 7. The Go service — `services/scene-nature-service`

Clone of the universe-service skeleton **minus** db/ai/repositories. Module
`github.com/myunivokai/myunivokai/services/scene-nature-service`.

```txt
services/scene-nature-service/
  cmd/api/main.go
  internal/config/config.go          # PORT, APP_ENV, LOG_LEVEL, INTERNAL_API_KEY (required in production)
  internal/httpx/                    # error envelope + request-id (same shapes as universe-service)
  internal/middleware/               # RequestID, Logging (zerolog), Recover, InternalKeyAuth (constant-time)
  internal/handlers/
    router.go                        # chi
    compose_handler.go               # POST /internal/v1/compose
    catalog_handler.go               # GET  /internal/v1/asset-catalog (ops/debug; FE reads the checked-in JSON)
    health_handler.go                # GET  /healthz, /readyz
  internal/scenes/forest/
    composer.go                      # Compose(input) → ForestSceneConfig — pure, deterministic
    forest_scene_profile.go          # mood→season weights, season tables, all bounds as named constants
    forest_scene_profile_test.go     # bounds over N seeds, distribution sanity (diversity-test style)
    composer_test.go                 # determinism + golden fixtures
    testdata/forest-golden-*.json    # byte-compared golden fixtures = the compatibility contract
  internal/assets/catalog.go         # versioned model/texture/HDRI key table + licenses
  internal/models/scene.go           # ForestSceneConfig structs (envelope shapes match universe-service)
  internal/seed/                     # byte-identical copy of universe-service/internal/seed (mirror comment)
  Dockerfile / Dockerfile.render     # no migrate binary, no entrypoint script — stateless
  go.mod
```

Compose contract (schemas in `contracts/scenes/`):

```txt
POST /internal/v1/compose
Headers: X-Internal-Key: <shared secret>, X-Request-Id: <propagated>
Body:    { "sceneType": "forest", "dna": {...}, "seed": "...", "variantNo": 2, "input": {...} }
200:     { "config": { ForestSceneConfig } }
400:     VALIDATION_ERROR (unsupported sceneType, malformed body)
401:     UNAUTHORIZED (missing/wrong internal key)
```

Non-goals v1: no rate limiter (the public edge is rate-limited at
universe-service; the key check rejects strangers at near-zero cost), no
swagger (the JSON Schemas in `contracts/scenes/` are the contract), no CORS
(never called from a browser).

## 8. universe-service integration (round N4 — the only prod-touching part)

All changes additive; the deployed universe path must be provably unchanged.

1. **Migration `000002_scene_type.sql`** (goose, additive):
   `ALTER TABLE world_variants ADD COLUMN scene_type TEXT NOT NULL DEFAULT 'solar-system';`
   On Postgres ≥ 11 (Neon) this is metadata-only — no table rewrite, old rows
   readable instantly. Down: drop column. Rehearse up+down on a Neon branch
   before deploy, same as always.
2. **Envelope:** `WorldSceneConfig` gains `SceneType string
   \`json:"sceneType,omitempty"\``. Additive-optional → **no schemaVersion
   bump** (contract rule). Old JSONB rows round-trip without the key
   (omitempty); new solar-system rows store `"sceneType": "solar-system"`.
3. **Registry:** new `internal/scenes` package — `SceneComposer` interface
   (per [backend-plan.md](backend-plan.md)), a solar-system adapter wrapping
   today's `WorldConfigBuilder` (locked by a **golden test proving
   byte-identical output**), and a `RemoteComposer` HTTP client for everything
   else: 2 s timeout, one retry on transport error (compose is idempotent),
   `X-Internal-Key` + `X-Request-Id` forwarded, in-memory LRU keyed
   `(sceneType, schemaVersion, seed, dnaHash)`.
4. **API (additive):** `POST /worlds` gains optional `preferredSceneType`;
   `POST /worlds/{id}/variants` gains optional `sceneType` (default: the
   selected variant's type). Validation against `SUPPORTED_SCENE_TYPES` env
   (default `solar-system`; prod flips to `solar-system,forest` only when the
   nature service is live). Invalid → 400 with field detail. Swagger regen.
5. **Failure taxonomy:** remote compose failure → `503 SCENE_UNAVAILABLE` +
   `Retry-After` (mirrors `AI_UNAVAILABLE`). Never a 500; never touches
   solar-system requests.
6. **Env:** `SCENE_NATURE_SERVICE_URL`, `INTERNAL_API_KEY`,
   `SUPPORTED_SCENE_TYPES` (see render.yaml below).

Prod-safety checklist (gate for merging N4):

- [ ] Golden test: solar-system config byte-identical before/after the registry refactor.
- [ ] Migration rehearsed up + down against a Neon branch; `RUN_MIGRATIONS_ON_START` flow unchanged.
- [ ] Old variants: `scene_type` backfilled by DEFAULT only; JSONB configs never rewritten; re-serializing an old config does not inject `sceneType`.
- [ ] With `SUPPORTED_SCENE_TYPES=solar-system` (prod default until nature is live), no code path can reach the remote client.
- [ ] Rollback: revert deploy — the extra column is harmless; or drop `forest` from the env to disable the family instantly.

### render.yaml additions (N1 for the service, N4 for the facade env)

```yaml
  - type: web
    name: myunivokai-scene-nature
    runtime: docker
    rootDir: services/scene-nature-service
    dockerfilePath: ./Dockerfile.render
    plan: free
    healthCheckPath: /healthz
    envVars:
      - key: APP_ENV
        value: production
      - key: INTERNAL_API_KEY
        sync: false            # same value pasted into myunivokai-api
```

`myunivokai-api` gains: `SCENE_NATURE_SERVICE_URL` (the Render URL),
`INTERNAL_API_KEY` (sync: false), `SUPPORTED_SCENE_TYPES`.

CI: third job `nature-service-checks` (go vet + test, working-directory
`services/scene-nature-service`) — unconditional first (the suite is small);
path filters only if CI time ever hurts.

## 9. Determinism & mirror discipline for this family

- Same three invariants as always: AI produces semantics only; every visual
  number from `seed.NewPRNG` within named-constant bounds; regenerate never
  calls AI.
- **Mirror pair:** `internal/scenes/forest/forest_scene_profile.go` ↔ (F5)
  `clients/web-client/src/features/scene-renderers/forest/sceneProfile.ts`,
  each carrying `FOREST_PROFILE_VERSION` asserted equal by a unit test on both
  sides (CI-enforced drift guard, per [frontend-plan.md](frontend-plan.md)).
- **Golden fixtures** in the composer's testdata are the compatibility
  contract: any byte diff ⇒ bump the forest schemaVersion and keep a reader
  for the old one. Saved forests must render forever.
- Rounding: reuse the `round()` 2-decimal convention. Known note from the 1.2
  review: Go `math.Round` and JS `Math.round` differ on negative halfway ties —
  the mirror is structural (distributions), not numeric, so this stays a
  documented non-issue.

## 10. Roadmap — rounds and gates

Backend first (owner order). One branch per round, off `staging`, PR after
gates. BE gates: `go vet ./... && go test ./... && go build ./...` per service.
FE gates: typecheck + lint + vitest + build.

| Round | Branch | Content | Done when |
| --- | --- | --- | --- |
| **N1** | `feat/be/nature-service-scaffold` | Service skeleton: config, middleware (request-id, logging, recover, internal-key), healthz/readyz, empty compose returning 400, Dockerfile.render, render.yaml entry, CI job | Deployed to Render; `curl /healthz` green on the public URL; universe-service untouched |
| **N2** | `feat/be/forest-composer-core` | `season` + `lighting` + `terrain` + `trees` + `landmarks` + camera/postFX-grade; forest profile with all tables; golden fixtures; `contracts/scenes/forest.schema.json` + compose request/response schemas | Determinism + bounds + distribution tests green (80–200 seed sweeps, diversity-test style); fixtures validate against the JSON schema |
| **N3** | `feat/be/forest-weather-wildlife` | `weather` (season matrix) + `wildlife` (slot draws) + `ambientParticles`; `internal/assets/catalog.go` + catalog endpoint; composer emits catalog keys only | Season↔weather matrix tests; counts scale with mood/energy; catalog-key emission test |
| **N4** | `feat/be/scene-registry-and-dispatch` | Everything in section 8 (migration, envelope, registry, remote client, API fields, 503 taxonomy, LRU, swag regen) | Prod-safety checklist all checked; e2e: `preferredSceneType=forest` against a local nature service stores a forest variant; universe flow byte-identical |
| **N5** | `feat/fe/nature-asset-pipeline` | Download/optimize/self-host GLB + HDRI + textures; `ATTRIBUTION.md`; finalize catalog (keys ↔ files ↔ licenses); budget audit | Every catalog key resolves to a file within budget; licenses recorded; vitest catalog guard green |
| **F1** | `feat/fe/scene-type-registry` | sceneType-first lazy registry (`next/dynamic` + CanvasLoader fallback); normalize legacy configs → `solar-system`; types become a discriminated union | Old worlds render unchanged; `/` bundle unchanged |
| **F2** | `feat/fe/forest-renderer-mvp` | Terrain + instanced trees + wind sway shader + HDRI lighting + landmark meshes with click-to-focus (`raycast` discipline for scenery) | A stored forest variant renders end-to-end; POI focus works |
| **F3** | `feat/fe/forest-seasons-weather` | Season dressing (ground/tint/blend), rain/snow particles, sun rays, fog, falling leaves / petals / fireflies / snow dust | All four seasons + transition visually distinct; weather matches config |
| **F4** | `feat/fe/forest-wildlife` | Animated GLB animals on seeded catmull-rom loops (walk/idle clips, pause beats), bird flocks (circling/crossing) | Animals/birds deterministic per seed; mobile counts respected |
| **F5** | `feat/fe/forest-preview-and-picker` | `buildPreviewForestConfig` mirror + `FOREST_PROFILE_VERSION` pair test; create-form **scene family picker** (Vũ trụ / Rừng cây cards, default universe); per-season grade polish; quality tiers | Preview mirrors the composer; picker round-trips `preferredSceneType`; full FE gates |
| **G** | (unchanged) | API gateway per [api-gateway.md](api-gateway.md) | Trigger unchanged: auth-service or a second public service |

N5 can run in parallel any time after N3 freezes the key list.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Free-tier cold chain (facade awake, nature asleep) | 503 + `Retry-After` + FE "waking up" toast; universe never blocked; optional later: starter plan for one service |
| Asset weight vs. sharpness | Budgets in section 6, Draco + WebP-1K now, KTX2 later; lazy route-level loading (F1) |
| Animals/birds are the hardest FE work | v1 patterns deliberately simple: closed-loop paths, no terrain-follow IK, clip crossfade only (F4 scoped to that) |
| Mirror drift multiplies with families | `FOREST_PROFILE_VERSION` pair test in CI from F5 day one |
| Bird model licensing unclear | Resolved in N5 before any FE work depends on it; CC-BY fallback with attribution |
| Registry refactor silently changes stored universes | Golden byte-identical test is the N4 merge gate |
| Blueprint/dashboard drift (render.yaml vs. real env) | render.yaml PR carries the env matrix; secrets stay `sync: false` in the dashboard (never in git) |
| Scope creep on seasons | Transition = single adjacent-season blend, capped; no time-of-year simulation |

## 12. Defaults chosen (flag to owner if wrong)

1. **Service name `scene-nature-service`** (upholds D4) with `sceneType:
   "forest"` as its first family — mountains/lakes join the same service later.
2. **Season is seed-random with mood bias** — the create form does not grow a
   season picker in v1 (regenerate rolls a new one; a picker can come later).
3. **Free tier accepted for v1** — cold-start "try again" UX instead of paid
   instances.
