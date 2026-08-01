# FE deferred work — execution plan

> **Document status:** Part A implemented; Part B planned, not approved
> **Last source review:** 2026-08-02

Two FE items were recorded across three documents with no execution plan
anywhere. This file is that plan, so a round starts from source facts instead of
re-reading the whole frontend.

- Part B is not approved. Do not execute without the owner's word.
- Each part is independently shippable — one branch each, not one big branch.
- Both parts were verified against source on 2026-08-02; findings are inline.

| Item | Origin document | State |
| --- | --- | --- |
| [Part A — dynamic family chunks](#part-a--deferred-fe-lazy-001-dynamic-family-chunks) | [threejs-scene-architecture.md](threejs-scene-architecture.md) §Family chunks, [../user-stories/engineering-backlog.md](../user-stories/engineering-backlog.md) | **Shipped** on `feat/fe/lazy-renderer-chunks` |
| [Part B — forest fidelity metrics](#part-b--us-forest-002-codify-the-fidelity-metrics) | [../user-stories/scene-fidelity.md](../user-stories/scene-fidelity.md) US-FOREST-002 | Planned / Unranked — proposed, not approved |

---

## Part A — DEFERRED-FE-LAZY-001 dynamic family chunks

Goal: a visitor who opens a forest world does not download the universe
renderer, and vice versa.

### Outcome — shipped

Implemented on `feat/fe/lazy-renderer-chunks`. First Load JS 512-526 kB →
436-450 kB across the five 3D routes; per-route table and the runtime mechanism
now live in [threejs-scene-architecture.md](threejs-scene-architecture.md)
§Family chunks, which is the doc to read. Three corrections to what this plan
predicted, kept because the reasoning is worth not repeating:

- **The `planetIdentityKey` blocker was overstated.** The helper was already a
  standalone module; `UniverseCanvas` only *re-exported* it, so the fix was
  deleting one line, not moving code. And it moved the bundle numbers by zero:
  every file importing the helper also imported the canvas, except
  `PlanetDetailsPanel`, which only renders on pages that mount the canvas anyway.
  It is still worth deleting — it would block a later canvas-level split — but it
  was hygiene, not a prerequisite.
- **`ComponentType` needed no widening.** `React.lazy`'s return type satisfies the
  registry's existing `SceneRendererComponent` as written; step 4's contingency
  never fired.
- **`next/dynamic` was the wrong tool, and only reading its source showed why.**
  Step 5 assumed any lazy wrapper would suspend into the existing boundary. In
  14.2.x `next/dynamic` does not suspend at all — `loadable.shared-runtime`
  renders a `loading` component, `null` by default. Because `SceneReadySignal`
  shares that boundary, it would have mounted immediately and lifted the opacity
  veil over an empty canvas. `React.lazy` throws the promise and preserves the
  original behaviour. Nothing in the build output or the test suite would have
  caught this — it is a visual regression that only shows on a cold cache.

What was verified, and what was not: `next build` output, the per-route
`app-build-manifest.json`, disjoint family markers in the two chunk files, and a
`next start` probe of the served HTML for all four route shapes. Not verified in a
browser: that opening a forest world requests *only* the forest chunk at runtime.
Which chunk gets requested follows from the prefetch call and the resolved
`sceneType`, so that part rests on the code, not on an observation.

One scope decision worth knowing: `/` prefetches **every** family after mount,
not just the selected one. It is the page whose whole job is choosing between
families, and a spinner on each flick of the picker is a worse trade than bytes
that arrive after first paint. The world and share routes still fetch exactly one
renderer, which is where the promise above actually has to hold.

### Source state before the change (kept as the baseline record)

- `scene-renderers/registry.ts:3-4` statically imports both family renderers.
- So every page that mounts a canvas ships both family code graphs.
- `SceneRendererComponent` is `ComponentType<SceneRendererProps>`
  (`scene-renderers/types.ts:20`) — a plain component type.
- `UniverseCanvas.tsx:109-111` resolves the component, then renders it inside
  `<Canvas>`.
- Four entry points import `UniverseCanvas` statically: `app/page.tsx:8`,
  `app/worlds/[worldId]/page.tsx:17`, `features/share/ShareWorldView.tsx:9`,
  `features/gallery/AmbientWorld.tsx:4`.
- There is **no** `next/dynamic` or `React.lazy` anywhere in the FE yet.
- 3D dependency weight sits in `three@0.171`, `@react-three/fiber`,
  `@react-three/drei`, `@react-three/postprocessing`.

### Coupling found — real, but not the blocker this plan claimed

- `components/PlanetDetailsPanel.tsx:5` imported `planetIdentityKey` **from**
  `UniverseCanvas`; `app/worlds/[worldId]/page.tsx` and `ShareWorldView.tsx` too.
- A pure helper re-exported from the canvas module means importing the helper
  drags three.js in with it.
- See the Outcome above for why this cost 0 kB in practice, and was still worth
  deleting.

### Steps

1. Run `npm run build` and record per-route First Load JS **before** touching
   anything. Without a before number, "improved" is unprovable — the same
   mistake Part B exists to prevent.
2. Delete the `planetIdentityKey` re-export from `UniverseCanvas`; point the
   three importers at `scene-renderers/planetIdentity`, where it already lives.
3. Convert the two registry entries to lazy components, keeping the registry's
   two-level resolution (`sceneType` first, then `theme`) unchanged.
4. Confirm the lazy component still satisfies `SceneRendererComponent`; widen the
   type only if the compiler demands it.
5. No new Suspense boundary: `<SceneRenderer>` already sits inside
   `<Suspense fallback={<CanvasLoader />}>` (`UniverseCanvas.tsx:164-175`), so a
   lazy component suspends on the boundary that exists. Leave it alone —
   `SceneReadySignal` shares that boundary, which is what keeps the veil up until
   the chunk *and* its assets are ready.
6. Prefetch the family chunk as soon as the family is known. The create form
   knows Universe vs Forest before the world exists, so the fetch can overlap
   generation instead of following it.
7. Re-run `npm run build`; compare against step 1.

### Verification

- Per-route First Load JS drops for the world and share routes.
- `npm run typecheck` and the full FE test run stay green.
- Manually: open a forest world, confirm the universe chunk is never requested
  in the network panel; then the reverse.
- The existing `isSceneReady` opacity veil (`UniverseCanvas.tsx:137`) plus
  `CanvasLoader` already cover a delayed first frame — no new loading UI.

### Risks

- Chunk fetch becomes serial after the config arrives → longer black screen.
  Step 6 is the mitigation, not an optional extra.
- `@react-three/drei` is shared by both families; it will not leave the common
  chunk, so expect a partial win, not a halving.
- Gallery ambient worlds mount several canvases; verify a lazy family resolves
  once, not once per instance.

### Cost

Small. One session. The risky part is step 6, not the split itself.

---

## Part B — US-FOREST-002 codify the fidelity metrics

Goal: every fidelity claim is a test, not a screenshot.

### Already satisfied — do not redo

- `forest/forestMath.test.ts` covers the opening camera: determinism, camera on
  dry land, inside the tree-free bank, eye above water, looking across not down,
  water fills ≥ ⅓ of frame, near bank in frame.
- So the frame-share and sight-line metrics named in US-FOREST-002 **are**
  already codified. Only three are missing.

### Missing metrics

| Metric | Threshold (from US-FOREST-001/002) | Where the input already exists |
| --- | --- | --- |
| Shoreline Development Index | > 1.15 | `createWaterOutline(seedText)` — `forestMath.ts:483` |
| Shoreline smoothness ("kink") | peak 2nd derivative of radius < 50 | same outline |
| No triangle fold under waves | Gerstner lateral shift < local vertex spacing | `ForestPondWater.tsx` |

### Blocker found

- The wave maths is JS, not GLSL — good, it is testable.
- But it is **module-private inside a `.tsx` component**: `SURFACE_WAVES:49`,
  `WAVE_STEEPNESS:66`, `RIPPLE_WAVE_COUNT:105`, the per-vertex displacement loop
  at `ForestPondWater.tsx:341-352`, and the anti-fold `lateralScale` guard
  at `:220`.
- A test cannot reach any of it without extraction first.

### Steps

1. Add `forest/forestFidelityMetrics.ts` — pure functions over an outline:
   `waterOutlinePerimeter`, `waterOutlineArea`, `shorelineDevelopmentIndex`,
   `shorelineKinkMetric`.
2. Test them across a wide seed sweep (the existing tests use hundreds of seeds;
   match that, not three hand-picked ones).
3. Extract the displacement into `forest/forestWaterMath.ts` as
   `gerstnerSurfaceDisplacement(x, z, time, lateralScale)`, exporting the wave
   table; `ForestPondWater.tsx` imports it and keeps its current behaviour.
4. Assert no fold: sample a vertex grid across several time samples, check the
   lateral shift never reaches local vertex spacing.
5. Record the measured numbers in [forest-realism-roadmap.md](forest-realism-roadmap.md)
   and tick the US-FOREST-002 tasks.

### Trap already paid for once

- SDI alone is gameable: it was once pushed to 1.58 with high harmonics and the
  lake looked **worse** — jagged notches, not bays.
- The kink metric is that counterweight. Never land an SDI change without it.

### Verification

- Extraction step 3 is behaviour-preserving: the rendered lake must be identical
  for a fixed seed, so review the diff for accidental constant changes.
- Full FE test run green; new tests fail if the thresholds are inverted.

### Cost

Medium — larger than Part A. Step 3 touches a live renderer, and a seed sweep
usually surfaces a handful of failing seeds that need judgement calls. Give it
its own session.

---

## Where this document is linked from

Back-links exist so this plan is reachable from any entry point:

- [../README.md](../README.md) — index structure table and audit snapshot
- [threejs-scene-architecture.md](threejs-scene-architecture.md) — §Performance
- [../user-stories/engineering-backlog.md](../user-stories/engineering-backlog.md) — deferred work section
- [../user-stories/scene-fidelity.md](../user-stories/scene-fidelity.md) — US-FOREST-002
- [forest-realism-roadmap.md](forest-realism-roadmap.md) — metric history
- [../vision/frontend-plan.md](../vision/frontend-plan.md) — lazy-chunk line item
