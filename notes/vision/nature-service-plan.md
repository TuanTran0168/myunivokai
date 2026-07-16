# Nature family — `nature-service` plan (v2, peer service)

Part of the [vision folder](README.md). Written 2026-07-16 against commit
`392f785` (staging = main, schema 1.2 live in production). **v2 supersedes the
v1 "stateless composer" draft** after the owner clarified the architecture:

> "Chỉ cần giữ nature-service. Hiện tại cứ random như universe service — cơ chế
> giống nhau, chỉ khác DNA thôi. Chưa có API gateway và FE đâu, cứ build
> services thôi."

Status: **approved direction, in build**. This document is the working context
for every future session on this track — it is deliberately self-contained.

---

## Tóm tắt cho owner (VI)

- **Kiến trúc:** `services/nature-service` là một service Go **ngang hàng và
  độc lập** với `services/universe-service` — **cùng một cơ chế**: input người
  dùng → AI sinh DNA (mặc định mock, như prod hiện tại) → builder deterministic
  theo seed → scene config → lưu → variants/share. **Chỉ khác lớp DNA**:
  planets trở thành **landmarks** trong rừng. `universe-service` **không bị sửa
  một dòng nào** — không migration, không field mới, zero rủi ro prod.
- **Chưa có gateway, chưa có FE** — đúng lời owner: chỉ build service. Gateway
  (Phase 3, [api-gateway.md](api-gateway.md)) sau này route theo prefix
  (`/api/universe/*`, `/api/nature/*`); FE sau này thêm picker "Vũ trụ / Rừng
  cây" và gọi thẳng base URL của từng service cho tới khi gateway có thật.
- **Sản phẩm:** rừng cây là "chân dung tính cách" thứ hai — gió thổi cây đung
  đưa, **4 mùa + giao mùa**, thời tiết **mưa/nắng**, **thú đi lại, chim bay**,
  **thu lá rụng, đông tuyết**. Mỗi DNA landmark là một điểm click-to-focus
  (cây thiêng, hồ nước, tảng đá, bụi hoa, thân cây đổ, đèn thờ).
- **Độ đẹp ưu tiên #1:** model GLB CC0 trên mạng (Quaternius/Kenney/Poly
  Haven), tự host, nén Draco; HDRI lighting, golden-hour bias, grade màu theo
  mùa.
- **Thứ tự:** N1 build cả pipeline trên memory store (đang làm) → N2 DB riêng
  (Neon database riêng + goose migrations + deploy Render) → N3 contract JSON +
  golden fixtures + swagger → N4 AI thật (Gemini/OpenAI port) → N5 curate
  asset. FE (F1–F5) sau khi service đứng vững.

---

## 1. Owner decisions (log)

| Date | Decision |
| --- | --- |
| 2026-07-16 (1) | Microservices immediately; forest scenery is the second family; Go backend first; beauty-first CC0 assets; gateway stays far-future. |
| 2026-07-16 (2) | **Architecture correction:** `nature-service` (not `scene-nature-service`) is a **full peer** of universe-service — same mechanism end-to-end (AI DNA → seeded builder → store → share), only the DNA layer differs. NOT a stateless compose endpoint; universe-service is not modified at all. No gateway and no FE work yet. |

Consequences vs. the old D1–D5 decision set:

- **D1 (`scene_type` on world_variants)** — moot for now: each service owns its
  own worlds; nothing dispatches by scene type. Revisit only when a gateway or
  a cross-service "portrait series" feature becomes real.
- **D2 (Go)** — unchanged, confirmed ("Backend bằng Golang").
- **D3 (gateway later)** — unchanged, confirmed ("chưa có API gateway").
- **D4 (one nature service for forest/mountain/lake)** — unchanged: the service
  is named `nature-service`; forest is its first scene family
  (`sceneType: "forest"`), mountains/lakes join later inside it.
- **D5 (embedded/remote flag)** — obsolete: there is no remote compose call to
  fall back from. "Rollback" = don't deploy / turn off the nature service;
  universe is untouched either way.

## 2. Where the code stands today (anchors for a fresh session)

| Piece | Where | Relevance |
| --- | --- | --- |
| The mechanism to clone | `services/universe-service` | chi router + middleware (request-id, logging, recover, per-IP rate limit) + CORS; `WorldService` (create/get/batch/regenerate/select/publish/share); AI `Orchestrator` (primary→repair→fallback, mock default); `Store` interface with memory + postgres implementations; goose migrations; zerolog. |
| Deterministic builder pattern | `internal/services/world_config_builder.go` + `mood/sky/diversity_scene_profile.go` | Dedicated PRNG stream per section, fixed draw order, named-constant bounds, `round()` 2dp, mirror-pair discipline. The forest builder follows exactly this. |
| Seeded PRNG | `internal/seed/prng.go` (FNV-64a → `math/rand`) | Copied byte-identical into nature-service. |
| Mock AI mechanism | `internal/ai/providers/mock.go` + `mock_presets.go` | Parses the user prompt back into a profile, picks a preset group by mood, personalizes planet names from interests/traits. Nature clones this with forest presets and landmark names. |
| Prod config | `render.yaml`, `Dockerfile.render`, `docker-entrypoint-render.sh` | Universe deploys with `AI_PROVIDER=mock` in production today ("cứ random như universe service"). Nature reuses the same deploy shape in round N2. |
| CI | `.github/workflows/ci.yml` | Gets a third job `nature-service-checks` (go vet + test). |

## 3. The product idea — a forest as a personality portrait

The visitor lands in a clearing. Trees sway in the wind. Depending on the
person: cherry blossoms drift in a spring shower, fireflies blink in a summer
dusk, red-gold maples shed leaves into an autumn mist, or snow settles
silently on pines. A deer crosses the path; a flock of birds arcs over the
treeline. Around the clearing stand **landmarks — one per DNA landmark**: the
heart-tree, a standing stone, a still pond, a flower patch, a fallen mossy
log, a small lantern shrine. Click one and the camera glides to it and reads
its meaning — the same POI interaction the universe has, in a new medium.

### Semantic mapping (input → NatureDNA → forest), all seed-deterministic

| Input | Drives | How |
| --- | --- | --- |
| `mood` | **Season bias** + wind + wildlife + bloom | focused → winter-leaning (crisp, still); dreamy → spring-leaning (blossom, soft); energetic → summer-leaning (lush, breezy, most wildlife); reflective → autumn-leaning (golden, misty). Weighted PRNG draw (~55/15/15/15), never a hard mapping. |
| Seed roll | **Giao mùa** | ~20% of variants blend toward an adjacent season (e.g. autumn → winter at 0.4: last leaves + first snow). |
| `favoriteColors` | Palette accents | Primary/secondary flow into `palette` exactly like universe. |
| `interests` / `traits` | **Landmark names** | The mock provider (and later the real AI prompt) names landmarks from the user's own interests/traits — same rule as universe planets. |
| NatureDNA `landmarks[]` | POI layer | Kind per landmark from a deterministic table (first is always the heart-tree); placement on the clearing ring from the `-forest-landmarks` stream. |
| Variant regenerate | New seed → possibly new season/weather | "Time and seasons as variant dimensions", for free, no AI call. |

## 4. Architecture — two peer services

```txt
 (future FE picker)                     (future FE picker)
        │                                      │
        ▼                                      ▼
 universe-service                        nature-service
 ─ REST /api/v1/*                        ─ REST /api/v1/*  (same route shapes)
 ─ AI DNA: PersonalityDNA (planets)      ─ AI DNA: NatureDNA (landmarks)
 ─ builder → WorldSceneConfig             ─ builder → ForestSceneConfig
   (schemaVersion 1.2, solar system)       (schemaVersion 1.0, sceneType "forest")
 ─ Neon DB (worlds, variants, share)     ─ own storage (memory now → own Neon DB in N2)
 ─ deployed, UNTOUCHED by this track     ─ new code, new deploy

 (Phase 3, unchanged trigger: one api-gateway in front, path-prefix routing —
  /api/universe/* and /api/nature/* — see api-gateway.md)
```

Rules:

- **universe-service is never modified** by this track. Zero migrations, zero
  new fields, zero shared code changes. Prod safety by construction.
- **Same mechanism, cloned**: router/middleware/error envelope/orchestrator/
  store interface are cloned into nature-service (small, boring, proven code).
  Shared-library extraction is deliberately NOT done now — two copies are
  cheaper than a premature `libs/` module; revisit at a third service.
- **Same route shapes** (`/api/v1/worlds`, `/variants`, `/publish`,
  `/share/worlds/{slug}`, `/healthz`, `/readyz`) so the future gateway is pure
  path-prefix routing and the FE client code can be reused per service.
- **AI stays mock by default** (`AI_PROVIDER=mock`), matching universe prod
  today. Real providers (Gemini/OpenAI) are a later round (N4) — the port is
  mechanical because the orchestrator/provider interfaces are identical.
- **Storage isolation**: nature-service gets its **own Neon database** (same
  Neon project, separate database → separate connection string, own
  `goose_db_version`), with the same table shapes (worlds, world_variants,
  ai_generations). No cross-service DB access, ever.

## 5. NatureDNA — same shape, forest semantics

`PersonalityDNA` → `NatureDNA`: identical envelope (schemaVersion, archetype,
sceneName, quote, shortNarrative, traitScores, energySignature, visualHints),
with **`planets[]` → `landmarks[]`** (`DNALandmark`: key, name, type, meaning,
energy; 3–7 items; named from interests/traits). Prompt version:
`forest-dna-v1`. The mock preset library is forest-flavored (Grove Keeper,
Dawn Wanderer, … per mood group), same selection mechanics as universe's
`mock_presets.go`.

## 6. `ForestSceneConfig` v1 — the contract

Envelope: `schemaVersion: "1.0"`, `sceneType: "forest"`, sceneName, archetype,
quote, theme, palette, camera, postFX (bloom + per-season `grade`), hud.
Renderers are keyed by `(sceneType, schemaVersion)`.

**Size discipline:** stored config stays ~3–4 KB. Only semantic and hero
placements are stored (landmarks). Mass scatter — hundreds of trees, grass,
leaf particles, bird paths — is computed **frontend-side from seeds embedded
in the config** (exactly like `MilkyWayConfig.Seed` today). BE decides *what
and how much*; FE derives *where* deterministically.

Sections (all bounds are named constants in `forest_scene_profile.go`):

| Section | Fields (summary) |
| --- | --- |
| `season` | kind (spring/summer/autumn/winter), optional blendTowardKind + blendAmount (giao mùa), foliageColors[3], groundKind (grass/leafLitter/snow/moss) |
| `lighting` | timeOfDay (day/goldenHour/dusk), sunElevationRadians, sunAzimuthRadians, sunColor, ambientColor, hdriKey, exposure, fogColor, fogDensity |
| `terrain` | placementSeed, clearingRadius, treelineRadius, hillAmplitude, hillFrequency, pathEnabled, rockCount, grassTuftCountDesktop/Mobile |
| `trees` | placementSeed, countDesktop/Mobile, speciesMix[{modelKey,weight}], scaleMin/Max, foliageTintStrength, windStrength, windDirectionRadians, windGustFrequency |
| `weather` | kind (clear/sunRays/overcast/rain/snow — season-constrained), intensity, cloudCoverage, rainDropCountDesktop/Mobile, snowflakeCountDesktop/Mobile |
| `wildlife` | groundAnimals[{modelKey,count,pathSeed,walkSpeed,scale}] (≤3), birdFlocks[{modelKey,birdCount,pathSeed,altitudeMin/Max,flightSpeed,pattern}] (≤2) |
| `ambientParticles` | fallingLeafCount (autumn), blossomPetalCount (spring), fireflyCount (summer dusk), snowDustCount (winter) |
| `landmarks[]` | one per DNA landmark: key,name,meaning,kind,angleRadians,radiusFromCenter,accentColor,energy — first kind is always heartTree |
| `assets` | catalogVersion, modelKeys[] (every GLB key the config references), hdriKey |

### PRNG streams — same discipline as universe schema 1.2

Every section draws from its own stream; **all draws always happen, in fixed
order, even when a gate zeroes the feature** — adding features later never
shifts existing draws. Labels are prefixed `-forest-` so future mountain/lake
families in the same service can never collide.

| Stream | Draws (fixed order) |
| --- | --- |
| `seed + "-forest-season"` | season roll (mood-weighted), transition roll, transition direction, blend amount, foliage palette pick |
| `seed + "-forest-lighting"` | timeOfDay roll, sun elevation, azimuth, exposure, fog roll, fog density, bloom |
| `seed + "-forest-terrain"` | clearing radius, hill amplitude, hill frequency, rock count, grass count, path roll, camera distance |
| `seed + "-forest-trees"` | count, species-mix pick, scale min, scale max, tint strength, wind strength, wind direction, gust frequency |
| `seed + "-forest-weather"` | kind roll (per-season weight table), intensity, cloud coverage (particle counts derive — no extra draws) |
| `seed + "-forest-wildlife"` | 3 fixed ground slots × (species, count, speed, scale) + 2 fixed flock slots × (bird count, altitude base, altitude span, speed, pattern); slots beyond the active count are drawn then discarded |
| `seed + "-forest-ambient"` | leaf count, petal count, firefly count, snow-dust count (each zeroed unless its season/time gate holds) |
| `seed + "-forest-landmarks"` | per landmark: kind roll, angle jitter, radius |

FE-side scatter streams (renderer, later — labels fixed now):
`{seed}-forest-tree-placement`, `-forest-grass`, `-forest-rocks`,
`-forest-animal-{index}`, `-forest-birds-{index}`, `-forest-leaves`,
`-forest-petals`, `-forest-fireflies`.

### Season tables (named constants)

| Season | Weather weights | Species mix | Wildlife | Ambient | Grade intent |
| --- | --- | --- | --- | --- | --- |
| spring | clear/sunRays/overcast/rain | birch, oak, pine, **blossom** | deer, rabbit, fox; most birds | blossom petals | fresh, slightly bright |
| summer | clear/sunRays/rain/overcast | oak, birch, pine (deep green tint) | deer, fox, boar, rabbit; birds | fireflies at dusk | warm, saturated |
| autumn | clear/sunRays/overcast/rain | oak, birch, dead (amber tints) | deer, fox, boar; fewer birds | **falling leaves**, mist bias | golden, +sat, +contrast |
| winter | clear/overcast/**snow** | pine, **pine-snow**, dead | deer, wolf, fox — sparse; rare birds | **snowfall** + snow dust | desaturated, cool, crisp |

Transition (`blendTowardKind`, `blendAmount` 0.2–0.6) keeps the dominant
season's weather/ground; the FE lerps tint/particle counts by the blend.

## 7. Beauty-first asset strategy (độ đẹp / độ sắc nét)

Unchanged from v1 of this plan — the quality ceiling is **assets + art
direction** (option B of
[3d-development-limitations.md](../3d-development-limitations.md)):

| Pack | License | Gives us |
| --- | --- | --- |
| Quaternius — Ultimate Nature / Stylized Nature MegaKit | CC0 | Trees (incl. snow-capped winter variants), rocks, stumps, grass, flowers |
| Quaternius — Ultimate Animated Animals | CC0 | Rigged deer, fox, wolf, rabbit… with idle/walk clips |
| Kenney — Nature Kit | CC0 | Prop fallback, path tiles |
| Poly Haven | CC0 | HDRIs (forest/meadow 1–2K), ground textures (grass, leaf litter, snow) |
| Birds (flapping, low-poly) | **TBD in N5** | Verify a CC0 animated bird; CC-BY fallback with attribution |

Rules: CC0 preferred, CC-BY with `ATTRIBUTION.md`; **never hotlink** — all
assets self-hosted under `clients/web-client/public/models/nature/` etc.
Pipeline: `gltf-transform optimize --compress draco --texture-compress webp
--texture-size 1024`. Budgets: GLB ≤ 500 KB, HDRI ≤ 2 MB, forest route lazy
payload ≤ 8 MB, forest JS chunk ≤ 300 KB gzip. The BE `assets` section only
emits keys from a versioned catalog table; a FE vitest later asserts every key
resolves to a real file (pattern: `planetTextureCatalog.test.ts`).

## 8. The Go service — `services/nature-service`

Module `github.com/myunivokai/myunivokai/services/nature-service`. A clone of
the universe-service layout, DNA layer renamed, no DB code until N2:

```txt
services/nature-service/
  cmd/api/main.go                     # memory store; refuses production start until the DB round
  internal/config/config.go           # env: PORT, APP_ENV, AI_*, RATE_LIMIT_*, TRUST_PROXY, SHARE_SLUG_LENGTH
  internal/httpx/                     # error envelope + request-id (same shapes as universe)
  internal/middleware/                # RequestID, Logging, Recover, per-IP RateLimit
  internal/models/                    # NatureDNA (landmarks), World/WorldInput/WorldVariant, ForestSceneConfig, responses
  internal/seed/                      # byte-identical PRNG copy + NAT-/VAR- seed generators
  internal/ai/                        # provider iface + Orchestrator (repair/fallback) — validator returns NatureDNA
  internal/ai/prompts/forest_dna_v1.go
  internal/ai/providers/mock.go|mock_presets.go   # forest preset library, landmarks named from interests/traits
  internal/aifactory/factory.go       # mock only; gemini/openai error "later round"
  internal/validation/world.go        # WorldInput rules (same), ValidateNatureDNA, NatureDNASchema
  internal/repositories/              # Store interface + MemoryStore (postgres lands in N2)
  internal/services/
    forest_scene_profile.go           # mood→season weights + every season/lighting/wildlife table + all bounds
    forest_config_builder.go          # the deterministic builder (streams above)
    world_service.go                  # create/get/batch/regenerate/select/publish/share — same flow as universe
  internal/handlers/                  # router, world_handler, share_handler, health_handler, landing (JSON)
  Dockerfile                          # parity with universe; Dockerfile.render + entrypoint land in N2
  go.mod
```

Public API (same shapes as universe — future gateway = path-prefix only):

```txt
POST /api/v1/worlds                          → 201 CreateWorldResponse (world, variant, natureDNA)
GET  /api/v1/worlds?ids=...                  → 200 WorldListResponse
GET  /api/v1/worlds/{worldId}                → 200 WorldResponse
POST /api/v1/worlds/{worldId}/variants       → 201 VariantResponse (no AI call — seed only)
POST /api/v1/worlds/{worldId}/variants/{variantId}/select → 200
POST /api/v1/worlds/{worldId}/publish        → 200 PublishResponse (share slug)
GET  /api/v1/share/worlds/{shareSlug}        → 200 PublicWorldResponse
GET  /api/v1/healthz | /api/v1/readyz        → liveness / store readiness
```

Error taxonomy identical: `VALIDATION_ERROR`, `NOT_FOUND`, `AI_UNAVAILABLE`
(503 + Retry-After), `AI_OUTPUT_INVALID` (502), `RATE_LIMITED` (429),
`INTERNAL_ERROR` — same envelope JSON, so FE error handling is reusable.

## 9. Determinism & mirror discipline

- Same three invariants: AI produces semantics only; every visual number from
  `seed.NewPRNG` within named-constant bounds; regenerate never calls AI.
- **Mirror pair (later, F-rounds):** `internal/services/forest_scene_profile.go`
  ↔ `clients/web-client/src/features/scene-renderers/forest/sceneProfile.ts`,
  with a `FOREST_PROFILE_VERSION` pair test on both sides once the FE exists.
- Golden fixtures (N3) become the executable compatibility contract; any byte
  diff ⇒ bump the forest schemaVersion and keep a reader for the old one.
- Known note from the 1.2 review: Go `math.Round` vs JS `Math.round` differ on
  negative halfway ties — the mirror is structural, documented non-issue.

## 10. Roadmap — rounds and gates

BE gates per round: `go vet ./... && go test ./... && go build ./...`.

| Round | Branch | Content | Done when |
| --- | --- | --- | --- |
| **N1** (in build) | `feat/be/nature-service-scaffold` | The whole pipeline on the memory store: config/middleware/handlers + NatureDNA + mock provider + orchestrator + forest profile & builder + worlds/variants/share API + tests + CI job. No deploy yet (memory store must not reach production — same guard as universe). | Gates green; `curl` end-to-end locally: create → get → regenerate → select → publish → share |
| **N2** | `feat/be/nature-db-and-deploy` | Own Neon database (same project, separate database + connection string), goose migrations (worlds, world_variants, ai_generations — same DDL shapes), `cmd/migrate`, postgres store, Dockerfile.render + entrypoint, render.yaml entry, deploy | Deployed on Render; created forest world survives restart; universe untouched |
| **N3** | `feat/be/nature-contract-and-docs` | `contracts/scenes/forest.schema.json`, golden fixtures in testdata, swagger (swag init parity), service README | Fixtures validate against the schema; swagger gated off in production |
| **N4** | `feat/be/nature-real-ai` | Port Gemini/OpenAI REST providers + repair prompts (mechanical — interfaces identical), env keys | Real DNA behind `AI_PROVIDER=gemini`; mock stays the fallback |
| **N5** | `feat/fe/nature-asset-pipeline` | Download/optimize/self-host GLB + HDRI + textures; ATTRIBUTION.md; finalize the key catalog; budget audit | Every catalog key resolves to a file within budget; licenses recorded |
| **F1–F5** | (after BE) | FE: sceneType registry → ForestRenderer MVP (terrain/trees/wind/HDRI/landmark POIs) → seasons+weather+particles → wildlife → preview mirror + create-form family picker calling nature-service's base URL | Standard FE gates per round |
| **G** | (unchanged) | api-gateway per [api-gateway.md](api-gateway.md): path-prefix routing to both services | Trigger unchanged: auth-service or when one public origin matters |

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Cloned plumbing drifts from universe-service over time | Acceptable by design (services are independent); extract a shared lib only at a third service |
| Memory store reaches production | Same fail-fast guard as universe: refuse production start without a database (until N2) |
| Free-tier cold start on a second service | Accepted (owner): "try again" UX; universe unaffected |
| Animals/birds are the hardest FE work | v1 FE patterns deliberately simple: closed-loop paths, clip crossfade only |
| Bird model licensing unclear | Resolved in N5; CC-BY fallback with attribution |
| Two mock DNA libraries to keep interesting | Forest presets live in one file (`mock_presets.go` clone); add presets freely — they are content, not code |

## 12. Defaults chosen (flag to owner if wrong)

1. **Same API route shapes** as universe-service (`/api/v1/worlds`…) so the
   future gateway is pure path-prefix routing and FE client code is reusable.
2. **Season is seed-random with mood bias** — no season picker in v1;
   regenerate rolls a new one ("cứ random như universe service").
3. **Own Neon database** (same Neon project) in N2 — no shared tables with
   universe-service, no cross-service reads.
4. **Mock AI only in N1** (matching universe prod today); real providers in N4.
