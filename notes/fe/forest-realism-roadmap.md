# Forest realism — where it stands and what is left

Companion to [forest-render-mechanism.md](forest-render-mechanism.md), which
explains *how* the forest renders. This file answers the recurring owner
question: **"forest đang ở cấp độ nào, và nên cải thiện gì tiếp?"**

Written 2026-07-27, branch `feat/fe-be/scene-realism-pass`.

## Level today: 3 of 5 — "stylised realism"

| Level | Meaning | Status |
|---|---|---|
| 1 | Flat primitives, cartoon palette | passed |
| 2 | Real GLB assets, real HDRI | passed |
| 3 | **PBR materials, correct light ratios, AO, real water** | **here** |
| 4 | Vegetation density + variety that reads as a real biome | partial |
| 5 | Photoreal (SSR/SSGI, volumetrics, terrain-blended assets) | not attempted |

It no longer reads as "hoạt hình" (cartoon), which was the original complaint.
What keeps it off level 4 is **density and variety**, not shading.

## What got it to level 3 (do not undo these)

- **Key-to-fill light ratio ~3:1.** The old rig ran sun 1.35 against ~1.27 of
  combined fill — a 1:1 ratio, which is the optical signature of overcast studio
  light. That was the real reason the sun "chưa giống thật", not its colour.
  Constants live at the top of `ForestRenderer.tsx` with the reasoning inline.
- **N8AO ambient occlusion**, forest-gated in `shared/PostEffects.tsx`. Contact
  shadows are most of what makes objects sit *on* ground rather than float.
  Note: `EffectComposer` children types reject `null`, so effects are assembled
  as a filtered JSX array.
- **PBR ground relief** — Poly Haven CC0 normal + ARM maps in `ForestTerrain`.
  Albedo deliberately stays vertex-colour/season-driven; only the relief comes
  from the texture, so seasons still work.
- **Real trees** — Sketchfab game-ready fir/oak packs, split into variants.
- **Distant treeline + rolling far hills** so the world does not end at a flat
  slab edge (`ForestDistantTreeline.tsx`, `DISTANT_*` in `forestMath.ts`).
- **Water** — see below.

## Water system (`ForestWaterway.tsx`)

Two halves, built differently on purpose:

- **Lake** — planar, at the **origin**. `MeshReflectorMaterial` is a real
  render-to-texture mirror and needs a planar mesh; the clearing centre is the
  one part of the height field guaranteed flat
  (`CLEARING_FLATTEN_INNER_FRACTION`). Radius = `0.46 × clearingRadius`.
- **River** — follows the rolling terrain, so it *cannot* be a planar mirror.
  Gets env reflection + scrolling ripple normals + transparency instead. Moving
  shallow water hides the absent mirror; still water would not.

Ripple normal map is **procedural** — summed sines at *integer* frequencies,
which is what guarantees seamless tiling. Zero asset bytes, no attribution
obligation. Shared singleton, cloned per surface so each scrolls independently.

### The shoreline must not be a circle

First attempt used `circleGeometry` and the owner's verdict was immediate: *"Hồ
nước quá tệ nó giống như một hình tròn vậy."* A perfect circle never reads as a
lake at any material quality.

Fixed with `createWaterOutline` in `forestMath.ts`: a seeded sum of sine
harmonics giving `radiusFactorAt(angle)`. **The frequencies must be integers**,
or the loop fails to close at `theta = 2*PI` and leaves a visible notch at the
seam — the same constraint the ripple normal map has, for the same reason.
Amplitudes sum to 0.30, so the outline reaches `1.30 ×` the mean radius; that
figure is `maximumOutlineRadiusFactor()` and is what neighbours must clear.

The water surface and its shoreline band are generated from the **same** seed, so
the bank keeps a constant width around an irregular shore.

**Rejected: downloading a lake GLB.** Tempting, and explicitly requested, but it
does not address either real defect — the circle came from our geometry, and the
white blowout came from our material. A downloaded mesh would inherit both, plus
the arbitrary pivot/up-axis problem that sank the baked-scene attempt.

### Why the surface read as plastic

Verdict was *"mặt hồ như miếng nhựa không giống nước"* with a visible square grid.
Three separate causes, and the first pass had fixed only the third:

**1. The ripple map was a lattice.** It summed four plane waves at frequencies
rounded off an evenly spaced fan — a textbook interference grid. Measured
self-correlation across the tile 0.852 (1.0 = exact repeat). Now 18 waves with
irregular frequency vectors: 0.618.

The wave count was chosen by sweeping, and **more is worse** — amplitude falls as
`1/λ²`, so extra high-frequency waves add almost no slope while still enlarging
the normalisation sum, flattening the water:

| waves / maxFreq | self-correlation | slope spread |
|---|---|---|
| 4 / 4 (old) | 0.852 | — |
| **18 / 7 (shipped)** | **0.618** | **0.136** |
| 28 / 9 | 0.700 | 0.116 |
| 48 / 13 | 0.605 | 0.090 |

**2. The second ripple layer was dead code.** `ForestPondWater` built a second
scrolling texture and advanced its offset every frame — and never bound it to
the material. The comment claimed two interfering layers; there was one, sliding
in a single direction, which is exactly what reads as a dragged plastic sheet.
It now feeds `distortionMap`, at `0.62 ×` the normal layer's tile scale and
scrolling the opposite way, so the two cannot correlate.

**3. Ripples were sized in UV, not world units.** A fixed texture repeat means
ripples scale with the surface, so making the lake hero-sized also gave it
metres-wide ripples. Repeat is now `diameter / RIPPLE_WORLD_TILE_SIZE`, and the
river's repeat was matched to it so both bodies of water have the same physical
chop.

Depth cue comes from **vertex colours** (dark centre, bright shallows) rather
than `MeshReflectorMaterial`'s depth-blend options — see below for why those are
unusable here.

### The reflector blew out

The first tuning showed white patches with a visible grid. Two causes:
`mixStrength 2.2` pushed the reflection past the sky's own brightness, and the
depth-blend parameters (`depthScale`, `minDepthThreshold`, ...) need a depth
buffer that this scene's **alpha-masked foliage does not populate cleanly**, so
they banded. Reflection is now a support term: `mixStrength 0.8`, `mirror 0.4`,
no depth blending.

**Only one reflector per scene.** The landmark pond had a second one, which at
its size appeared purely as a blown-out white blob for the cost of a whole extra
scene render. It now uses environment reflection (`reflective={false}`).

### Terrain sampler split

`clearFloorDistanceSampler` (path + water) goes to **trees and decor** only.
`ForestTerrain` gets the **path-only** sampler, because that sampler also *paints*
the ground as bare dirt — running it over the river turned the channel into a
wide tan road across the whole clearing.

### Making the lake big required carving the terrain

The lake started at `0.46 × clearing` and the verdict was *"Hồ nước phải to đùng"*.
It is now `0.85 × clearing`, which **does not fit inside the terrain's naturally
flat zone** (`CLEARING_FLATTEN_INNER_FRACTION` = 0.65). Simply enlarging the disc
puts rolling hilltops through the middle of a planar water surface.

So `createTerrainHeightSampler` now **carves a basin**. This is the load-bearing
detail: the carve is driven by the **signed** shore distance
(`createLakeSignedEdgeDistanceSampler`), not the clamped one. Driven from the
clamped distance the bed is flat at full depth right up to the shoreline, and the
water plane ends up perched on a vertical wall as deep as the lake. Signed, the
surface passes through exactly zero at the waterline: it shelves down to
`LAKE_BED_DEPTH` over `LAKE_BED_SHELF_WIDTH` going in, and climbs back to the
hills over `LAKE_SHORE_BLEND_WIDTH` going out.

Verified numerically before shipping (worth redoing after any change here):
shoreline discontinuity 0.0001 m, highest terrain inside the lake exactly at the
waterline, depth profile `0 → −0.13 → −0.47 → −1.33 → −1.80` at 0/0.5/1/2/3 m in.

### Angle convention — easy to get silently backwards

The water mesh is built in local XY and laid flat with a `-PI/2` X rotation, which
maps local `(x, y)` to world `(x, -y)`. So the world angle `atan2(z, x)` is the
**negated** authoring angle — hence `waterOutlineAngleAt`. Get this wrong and the
shoreline is mirrored relative to every exclusion test, which shows up only as
objects standing in water exactly where the outline bulges. Checked: worst
geometry-vs-sampler mismatch 3.55e-15.

### The river must not cross the lake

First version ran one ribbon from `-span` to `+span` through the origin, so a
light strip with its own banks was drawn on top of the water — *"nó bị sông đè lên
rồi"*. Now there are **two** ribbons, outflow and inflow, each starting at
`riverLakeExitDistance` (the outline radius at the river's own heading, so the
mouth lands on the shore even where the lake bulges) minus a small overlap.

### Things the backend positions by radius alone

`landmark.radiusFromCenter` comes from Nature DNA and knows nothing about the
lake, so lanterns and shrines stood in open water. `ForestRenderer` computes
`shoreClearanceRadius` and both `ForestLandmarks` and `ForestWildlife` clamp to
it. **Anything new placed by radius needs the same treatment.**

**The radii are a coupled set. Changing one breaks another:**

| Feature | Radius | Why |
|---|---|---|
| Lake (mean) | `0.85 × clearing` ≈ 8.1 | hero-sized; requires the terrain carve |
| Lake (max) | `1.30 × mean` ≈ 10.5 | `maximumOutlineRadiusFactor()` |
| `shoreClearanceRadius` | max + 1.8 ≈ 12.3 | dry land for landmarks and animals |
| Animal wander | 12.3 → 22.8 | anchored to the **shore**, not a clearing fraction |
| Decor / tree scatter | `0.9 × clearing` ≈ 8.6 | inside the lake now, so `clearFloorDistanceSampler` skips those picks — decor is thinner near the water by design |
| River span | `0.82 × treeline` | stops short of `DISTANT_RISE_INNER_FRACTION` so the channel never climbs the far ridge |

Water is a no-grow surface exactly like the dirt path, so
`createRiverEdgeDistanceSampler` is composed with the path sampler into one
`clearFloorDistanceSampler` in `ForestRenderer`. Consumers (terrain texture,
trees, decor) did not have to learn about the river.

## Wildlife: the "giật lùi về" bug

Animals occasionally jerked/teleported backwards. **Two independent causes**,
both fixed in `ForestWildlife.tsx`:

1. The ping-pong heading flipped a full 180° on a single frame at each
   waypoint. Now the yaw eases at `ANIMAL_YAW_TURN_RATE_RADIANS_PER_SECOND`,
   so the turn happens during the existing end-of-path pause.
2. `elapsedSeconds` accumulated **raw** `deltaTime`. Any frame hitch — a GLB
   finishing its decode, tab blur, a shader compile — hands `useFrame` one huge
   delta, which jumps the ping-pong parameter far enough to teleport the animal,
   sometimes visibly backwards along its own path. Clamped to
   `MAXIMUM_ANIMAL_FRAME_DELTA_SECONDS` (1/15s).

Lesson worth generalising: **any `useFrame` that integrates a looping parameter
needs a delta clamp**, or a hitch reads as a teleport.

Separately, feet-not-stepping was a clip/ground-speed mismatch, fixed by
driving `action.timeScale` from the config `walkSpeed`
(`WALK_CLIP_TIMESCALE_PER_WALK_SPEED`) and freezing it to 0 during the pause.

## Next, in value order

1. **Undergrowth density (biggest remaining win).** `MAXIMUM_DECOR_PIECES = 90`
   over the whole floor is sparse; real forest floors are cluttered. Wants
   instanced grass cards, not more GLB props.
2. **Terrain-blended tree bases.** Trunks meet the ground on a hard line. A
   ring of moss/litter cards at each trunk base is the cheap fix.
3. **Volumetric god rays** for the `sunRays` weather kind — currently only a
   light-intensity multiplier.
4. **Still-stylised on purpose:** birch (white bark *is* the species identity),
   dead trees, snow pine. Upgrade only if they specifically look wrong.
5. **Water polish:** shoreline foam line, and depth-based colour ramp so the
   lake middle is darker than its edge.

## Performance budget — unverified

Per forest, desktop: ~180 LOD0 trees + ~260 distant trees + N8AO + 3072²
shadow map + a 512² reflector re-render (the lake draws the scene twice).

**No real-device FPS measurement has been taken.** If it stutters, turn these
knobs in this order — cheapest visual loss first:

1. lake reflector `resolution` 512 → 256
2. `SHADOW_MAP_SIZE` 3072 → 2048
3. `ForestDistantTreeline` counts
4. `trees.countDesktop`

## Asset rules learned the hard way

- **Geometry is the bottleneck, textures are cheap.** Poly Haven trees were
  57.9 MB (smallest) to ~900 MB of `.bin` — unusable. Sketchfab game-ready packs
  are the right source.
- **Draco for static geometry, meshopt for animated/skinned.** Draco destroys
  skeletal animation.
- **Never run `simplify` on alpha-masked foliage.**
- **Check `isDownloadable` + license slug BEFORE downloading.** An API token
  cannot override an author's download setting — three candidate models 403'd.
- **Do not use whole-scene "baked" meshes for the forest.** Tried and reverted;
  see the `forest-baked-scene-approach-failed` memory. Display scenes carry
  arbitrary up-axis/pivot and some are aerial photogrammetry tiles — they render
  as tilted floating slabs with the animals underneath.

## Rare features

`solar-system/rareFeatures.ts`. Black hole walked 6% → 20% → **40%** (owner
decision: it is the showpiece and should be easy to find while iterating). The
contract test bound in `rareFeatures.test.ts` moved with it and now asserts
`< 0.5` — "rare" must never mean the majority case.

The 20% step alone did not make it findable, and that turned out **not** to be a
probability bug: `DistantBlackHole` sat at radius 30 while `CameraRig`'s
`ORBIT_CONTROLS_MAXIMUM_DISTANCE` is 26, so it was parked outside the view cone
almost always. Now at radius 18, elevation 7. **Placement is constrained by the
camera envelope, not by taste.**
