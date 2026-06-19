# FE Production Refactor Plan — clients/web-client

Goal: end the MVP phase. Each item is **one branch + one separate PR**, in
order. Every branch must pass `npm run typecheck && npm run lint && npm run build`,
and from the testing setup onward must ship with unit tests (vitest).

Status: mark ✅ when the PR is merged into `staging`.

| # | Branch | Priority | Status |
|---|---|---|---|
| 1 | `fix/fe/scene-render-consistency` | 🔴🔴 highest — visible bug | ✅ |
| 1b | `feat/fe/mood-style-impact` | 🔴 highest — pairs with BE mood | ⬜ |
| 2 | `feat/fe/unit-testing-setup` | 🔴 foundation | ⬜ |
| 3 | `refactor/fe/typed-api-client` | 🔴 required before deploy | ⬜ |
| 4 | `refactor/fe/form-validation` | 🔴 required before deploy | ⬜ |
| 5 | `refactor/fe/page-decomposition` | 🟡 structure | ⬜ |
| 6 | `feat/fe/toast-and-loading-states` | 🟡 UX | ⬜ |
| 7 | `feat/fe/share-page-ssr-metadata` | 🟡 social sharing | ⬜ |
| 8 | `feat/fe/mobile-performance` | 🟡 weak devices | ⬜ |
| 9 | `refactor/fe/cleanup-a11y` | 🟢 cleanup | ⬜ |

## 1. fix/fe/scene-render-consistency

Problem: the 3D scene is built **three different ways in three places**, so the
same world looks different depending on where you view it, and the create-page
preview does not render the real scene at all.

Confirmed root causes (read from the code, not guessed):

1. **The "Live DNA Preview" renders the abstract fallback, never the real scene.**
   `app/page.tsx` passes `selectedVariant({ id: "preview", variants: [] })`,
   which is `undefined`; `sceneFromVariant(undefined)` returns a scene with no
   planets and no theme; `UniverseCanvas` then sees `hasConfiguredPlanets ===
   false` and forces `FallbackUniverseRenderer`. The preview ignores every form
   field (mood, palette, style, interests) and looks nothing like the
   solar-system the user gets on `/worlds`. The "SYNCING..." label is decoration.
2. **Three different fallback seeds.** `lib/scene.ts` uses
   `"myunivokai-local-seed"`, `UniverseCanvas` uses `"myunivokai"`, and
   `sceneFromVariant` chains `seed ?? id ?? "myunivokai-local-seed"`. When a seed
   is missing, the same world draws a different star field / orbit inclination on
   different pages because `randomFromSeed` receives a different input.
3. **Scene construction is duplicated across call sites that drift.** `/worlds`
   builds the scene via `sceneFromVariant` (`seed ?? id ?? FALLBACK`); `/share`
   builds it via `buildShareSceneConfig` (`{ seed: variant.seed, ...config }`,
   no `?? id` branch). A published world whose `variant.seed` is empty therefore
   renders with a different seed on `/share` than on `/worlds`. The BE share
   contract (`PublicVariant.Config`) does include the full planet list, so this
   is purely an FE consistency bug.

Work:

- **One source of truth for scene construction.** Move all scene building into a
  single `resolveSceneConfig(variant)` (or extend `sceneFromVariant`) in
  `lib/scene.ts`, used by the world page, the share page, and the normalize
  layer. Delete `buildShareSceneConfig`'s separate `??` chain; the share page
  must produce the same `SceneConfig` the world page does for the same variant.
- **One canonical fallback seed.** Declare `CANONICAL_FALLBACK_SEED` once in
  `lib/scene.ts`; `UniverseCanvas` imports it instead of its own literal. No
  second seed constant anywhere.
- **Make the Live DNA Preview real and local.** Build a deterministic preview
  `SceneConfig` from the current form state (palette ← favoriteColors,
  background ← mood, planet count ← interests/traits, seed ← a hash of the
  inputs) and render it through the SAME `SolarSystemRenderer`. No backend / AI
  call (we never call AI from the FE) — purely local and deterministic via
  `randomFromSeed`. The preview then matches the look-and-feel of the result and
  updates live as the user edits the form.
- **Confirm `/share` renders the solar system.** Verify the BE share service
  actually populates `variant.config.planets`; with the unified builder, a
  published world must render the same solar system on `/share` as on `/worlds`,
  never the abstract fallback (unless planets are genuinely absent).
- Bootstrap a minimal `vitest` config here (the full setup + CI wiring is item
  2) and add a regression test: the same variant yields an identical
  `SceneConfig` (seed + planet count) on every code path, and the preview
  builder is deterministic for fixed inputs.

Acceptance:

- The create-page preview shows a solar system that reflects the chosen palette
  / mood / style and updates as the form changes — not the abstract blob.
- A given world renders consistently on `/worlds` and `/share` (same seed → same
  star field and orbits).
- `/share` renders the solar system for any published world.
- `npm run test` covers the unified scene builder and the preview builder.

## 1b. feat/fe/mood-style-impact

Problem: the Atmospheric Mood and World Style controls did not stand out when
selected, and neither changed the Live DNA preview — World Style was a plain
`<select>` and Mood only reshuffled the seed.

Work:

- Make selection prominent: Mood and World Style are both button grids now
  (ring + glow + scale + a check badge on the selected one); World Style is no
  longer a dropdown.
- Mood drives the preview's bloom, star density, motion and background via a
  `MOOD_SCENE_PROFILES` map that mirrors the backend `moodSceneProfile`
  (`feat/be/mood-scene-params`) exactly, so the preview and the generated world
  react to mood in the same direction.
- World Style drives the orbital character (orbit inclination multiplier per
  theme) in the shared `SolarSystemRenderer`, so the style choice visibly
  changes both the preview and the generated world without overriding the
  user's color palette.
- Tests: the mood profile mapping (energetic brighter/busier than reflective,
  neutral fallback) and the mood background applied to the built preview.

Pairs with BE `feat/be/mood-scene-params`; the mood mapping values are kept
identical on both sides.

Acceptance: clicking a Mood or World Style visibly changes the preview, and the
selected control is unmistakable.

## 2. feat/fe/unit-testing-setup

Problem: the FE has zero tests. The "variants at response root" bug survived
every check because only typecheck/lint run — a unit test on normalize would
have caught it.

Work:

- Install `vitest` + `@testing-library/react`, add an `npm run test` script
  (building on the minimal vitest config introduced in item 1).
- First tests for the two riskiest areas:
  - `lib/api.ts`: normalizeWorld/normalizeVariant/normalizeShare against JSON
    fixtures copied from the real BE shapes (`models/responses.go`).
  - `lib/scene.ts`: `randomFromSeed` determinism, `planetsFromScene`, `paletteFromScene`.
- Add the test step to CI (`.github/workflows/ci.yml` has a reserved TODO) and
  update `notes/fe/source-overview.md`.

Acceptance: `npm run test` runs in CI; both lib files covered.

## 3. refactor/fe/typed-api-client

Problem: `lib/api.ts` is full of `any` and defensive `??` fallback chains for
shapes that do not exist (`world_id`, `scene_config`, ...). Defensive code like
this hides bugs instead of exposing them (lesson from the variants bug).

Work:

- Define zod schemas for each real BE response (`CreateWorldResponse`,
  `WorldResponse`, `VariantResponse`, `PublicWorldResponse`) — exactly ONE
  shape per endpoint, no snake_case guessing.
- `request<T>()` parses through zod: a wrong-shaped response throws a clear
  error naming the bad field instead of silently rendering fallback visuals.
- Remove every `any` from `lib/api.ts`; derive `lib/types.ts` types via
  `z.infer` so they can never drift.

Acceptance: no `any` left under lib/; fixture tests pass; a response missing a
key field throws an error that names the field.

## 4. refactor/fe/form-validation

Problem: the create form silently fills defaults when fields are empty
(empty nickname becomes "Neo", empty goal becomes a generated sentence). That
violates the explicitness principle and users never learn what was sent.

Work:

- Install `react-hook-form` + zod resolver (both in the original plan's stack).
- Zod schema mirroring the BE validation rules (`validation/world.go`):
  nickname 2-32, interests 3-8, traits 3-6, goal 10-220, ...
- Show per-field errors under each input; disable submit while invalid.
- Delete `ensureRange`/silent defaults; make the "Custom" interest button real
  (today it is decoration only).
- Map BE `VALIDATION_ERROR.details` back onto the matching form fields.

Acceptance: submitting an empty form shows per-field errors and sends no
request; a BE 400 with details highlights the right fields.

## 5. refactor/fe/page-decomposition

Problem: `app/page.tsx` is 335 lines mixing landing + form + options; the world
page also owns too much logic. The original plan's feature-folder structure is
not followed.

Work:

- Split per the original plan:
  - `features/create-universe/`: `CreateUniverseForm.tsx`, `formSchema.ts`,
    `constants.ts` (interestOptions, moodOptions, ... leave the page).
  - `features/dashboard/`: `WorldHeaderPanel.tsx`, `PublishPanel.tsx`,
    `VariantsPanel.tsx` (the world page only composes + holds state).
- Each page.tsx is roughly 80 lines or less, orchestration only.
- No behavior change — pure refactor; tests from earlier items must pass untouched.

Acceptance: build + tests pass; the page.tsx diff is mostly deletions.

## 6. feat/fe/toast-and-loading-states

Problem: notices are static StatusMessages that never dismiss; API errors show
raw; the canvas Suspense fallback is null, so texture loading shows a black box.

Work:

- Toast component (auto-dismiss after `TOAST_AUTO_DISMISS_MILLISECONDS`,
  stacking, success/error variants) replacing static notices on the world page.
- A real Suspense fallback in the canvas: spinner/skeleton instead of null.
- Action buttons (publish, variant, export) share a consistent disabled+spinner
  treatment.

Acceptance: creating a variant pops a toast that disappears by itself; a slow
world page shows a skeleton instead of a black block.

## 7. feat/fe/share-page-ssr-metadata

Problem: the share page is a client component — links shared to
Facebook/Zalo/Twitter get no title/preview (bots do not run JS). This is the
one page that needs SEO.

Work:

- Convert `share/worlds/[shareSlug]/page.tsx` into a server component fetching
  from the API (the 3D canvas stays a client child).
- `generateMetadata()`: title = sceneName, description = shortNarrative,
  OpenGraph + Twitter card.
- (Optional) an `opengraph-image` route rendering a simple OG image from the
  palette + scene name.

Acceptance: `curl` on a share page shows og:title/og:description in raw HTML.

## 8. feat/fe/mobile-performance

Work:

- Detect weak devices (deviceMemory/hardwareConcurrency) and apply a named
  `qualityProfile`: lower dpr, bloom off, fewer sphere segments.
- A resize listener for particle counts (currently read once at mount).
- Lazy texture loading: distant planets use flat colors until textures arrive
  (avoids the initial white flash).
- Test on a real phone; record results in the PR.

Acceptance: no severe frame drops in Lighthouse mobile; no WebGL crash on the
test device.

## 9. refactor/fe/cleanup-a11y

Work:

- `aria-label` on every icon-only button (export, copy, remove, ...).
- Focus trap in GeneratingOverlay; `prefers-reduced-motion` disables the
  spinning animation.
- Sweep remaining magic numbers into named constants (notes/coding/coding-style.md).
- Delete dead code/imports; re-sync `notes/fe/source-overview.md` with the new
  structure.

Acceptance: `npm run lint` passes with jsx-a11y rules enabled.

## Definition of production-ready (FE)

- [ ] The scene renders consistently everywhere: the create-page preview, the
      world page, and the share page draw the same world the same way.
- [ ] Unit tests for lib (api normalize, scene helpers) run in CI.
- [ ] No `any` left in `src/lib/`.
- [ ] The form validates for real and never invents data for the user.
- [ ] Share links unfurl properly on social networks.
- [ ] Runs smoothly on a mid-range phone.
- [ ] Every page.tsx only orchestrates; logic lives in features/.
