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

**The radii are a coupled set. Changing one breaks another:**

| Feature | Radius | Why |
|---|---|---|
| Lake | `0.46 × clearing` | must stay inside the flat zone |
| Animal wander (inner) | `0.62 × clearing` | keeps animals off open water |
| Decor / tree scatter | `0.9 × clearing` | pre-existing |
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
