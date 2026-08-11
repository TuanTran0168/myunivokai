# Frontend modernization research — Next.js 16, React 19, R3F v9, WebGPU

> **Document status:** Research. **Nothing here is approved and nothing here is
> built.** No dependency was changed to produce it.
> **Raised:** 2026-08-12 by the owner — *"cái này khá nguy hiểm vì các function
> có thể outdate hoặc lỗi diện rộng toàn FE… nó có thể phá sập hệ thống nếu hời
> hợt"*.
> **Last source review:** 2026-08-12
> **Method:** every version number and peer-dependency range below was read from
> the **npm registry** on 2026-08-12, and every framework claim from the
> **official upgrade guide**, not from memory. Where a thing could not be
> verified this session it is listed under §What is still unverified rather than
> asserted. That section is not an apology; it is the part to read first if
> someone is about to start.
> **Supersedes:** [platform-evolution-research.md](platform-evolution-research.md)
> §Track D, which contains three errors of fact corrected in §Corrections below.

---

## The headline: the premise of this migration is wrong

Every prior note in this repo, including Track D, assumed the chain
*security advisories → Next 16 → React 19 → R3F v9 → WebGPU*, with Next **16**
as the entry point because that is what `npm audit fix --force` prints.

That is not what the advisory data says.

`npm audit` reports **21 separate advisories against `next`** in
`apps/myunivokai-web`. Their fixed-version boundaries are:

```
<15.0.8   <15.5.10   <15.5.13   <15.5.14   <15.5.15   <15.5.16   <15.5.21
```

**The highest boundary is `15.5.21`.** The published `next` `backport` dist-tag
is **15.5.23**. So:

> **`next@15.5.23` clears all 21 of them. Next.js 16 is not required to close
> the framework's own security hole.**

npm prints `16.3.0` because `fixAvailable` reports the `latest` tag, not the
minimum sufficient version. Acting on that print is how a security patch turns
into a two-major-version rewrite of the only public-facing app.

(One nested advisory does survive Route A, and it is examined honestly in
§The catch below — it does not change this conclusion, but nobody should meet
it by surprise.)

This changes the shape of the decision from *"when do we dare do the big
upgrade"* to *"do we take the small one now and the big one on its own
schedule"* — and those have very different risk profiles.

One caveat, stated up front because it is the counter-argument: **Next 14 has
no patched release.** The advisory ranges start at `>=13.0.0` / `>=10.0.0` and
end in the 15.5.x line with no 14.x carve-out, so `next@14.2.35` — the newest
14 — is still inside every one of them. Staying on 14 is not an option that
survives contact with the data. The choice is 15 or 16, not 14 or 16.

### And the exposed surface is smaller than "8 high" suggests

`npm audit` reports **8 high** for `myunivokai-web`. `npm audit --omit=dev`
reports **3**:

| Advisory | Ships to users? | Source |
| --- | --- | --- |
| `next` | **yes** | direct dependency |
| `postcss` | **yes** | transitive, via `next` |
| `nanoid` | **yes** | transitive, via `postcss` |
| `eslint-config-next`, `@next/eslint-plugin-next`, `glob`, `brace-expansion`, `js-yaml` | **no — devDependencies** | the ESLint 8 toolchain |

All three production advisories trace to one root: `next`. And the acceptance
criterion written into
[`S1-SECURITY-001`](../sprints/sprint-01-2026-07-22/user-stories.md) is
literally *"`npm audit --omit=dev --audit-level=high` exits 0"* — so **only
those three count against the story**.

Which means the ESLint 8 → 9 / flat-config work, which the story lists as part
of the upgrade and which Next 16 forces, **carries no security urgency at all**.
It is a devDependency cleanup that can be scheduled on its own merits, on its
own day.

### The catch, and it is a real one

`next` pins `postcss` **exactly**, and it does not move it until 16:

| `next` | pinned `postcss` | vs advisory (`<=8.5.22`) |
| --- | --- | --- |
| 14.2.23 (installed) | `8.4.31` | vulnerable |
| **15.5.23** | **`8.4.31`** | **still vulnerable** |
| 16.3.0 | `8.5.23` | clear |

So the accurate statement is narrower than the headline:

> **`next@15.5.23` clears all 21 `next` advisories, but not the `postcss` and
> `nanoid` ones nested underneath it. `npm audit --omit=dev --audit-level=high`
> would still exit non-zero on Route A.**

The repo's own top-level `postcss` devDependency can be bumped freely
(`8.5.26` is published), but that only fixes the hoisted copy — `next` keeps
its own at `node_modules/next/node_modules/postcss`, and only a move to 16
replaces it.

**How much this actually matters is a judgement, and it should be made
explicitly rather than by a red CI line.** The two `postcss` advisories are
*"XSS via unescaped `</style>` in CSS stringify output"* and *"arbitrary file
read"* — both require **attacker-controlled CSS reaching the parser**. PostCSS
here runs at build time, in CI, over this repository's own stylesheets. There
is no path by which a visitor supplies CSS. Compare that with the `next`
advisories being closed: SSRF in rewrites, cache poisoning of RSC responses,
XSS in App Router, DoS — all of them on the request path of a live public site.

Route A therefore closes **the entire class of risk that is real here** and
leaves a build-time parser advisory that the criterion counts but the threat
model does not. Two defensible responses:

- **Amend `S1-SECURITY-001`** to except build-time-only transitive advisories,
  with this paragraph as the reasoning, and take Route A.
- **Take Route B** and satisfy the criterion literally.

What should *not* happen is discovering this at the end of Route A and calling
the upgrade a failure because a number is not zero.

That story also predates the current data in two further ways worth correcting
when it is next touched: it records *"one high and one moderate"* from the
2026-07-23 audit (now three high in production), and it states *"its available
remediation is a Next.js 16 major upgrade"* — true for `postcss`, and not the
reason it says.

---

## Verified landscape, 2026-08-12

Installed versus published. Every "latest" read from the npm registry today.

| Package | `myunivokai-web` has | Latest published | Gap |
| --- | --- | --- | --- |
| `next` | `14.2.23` | `16.3.0` | 2 majors |
| `react` / `react-dom` | `18.3.1` | `19.2.8` | 1 major |
| `@react-three/fiber` | `8.18.0` | `9.7.0` | 1 major |
| `@react-three/drei` | `9.122.0` | `10.7.8` | 1 major |
| `@react-three/postprocessing` | `2.19.1` | `3.0.5` | 1 major |
| `three` | `0.171.0` (2024-11-29) | `0.185.1` (2026-07-01) | 14 minors, ~19 months |
| `tailwindcss` | `3.4.17` | 4.x | 1 major |
| `eslint` | `8.57.1` | 9.x | 1 major |

And the fact that reframes everything — **the other app is already there**:

| | `myunivokai-web` | `myunivokai-admin` |
| --- | --- | --- |
| `next` | 14.2.23 | **15.5.22** |
| `react` | 18.3.1 | **19.0.0** |
| `tailwindcss` | 3.4.17 | **4.x** |
| `eslint` | 8.57.1 | **9.x** |
| three.js | yes, heavily | **none** (a boundary script forbids it) |
| Deployed on | Vercel | Vercel |

`myunivokai-admin` has been running Next 15 + React 19 on Vercel in CI and in
production shape for the whole of this project. **The framework half of this
migration is already proven in this repo.** What is unproven is exclusively the
3D half — which is also the half no test covers (§The blind spot).

---

## The dependency knot

This is where a careless `npm install` does the damage. Peer ranges, read from
the registry today:

| Package | version | `react` | `three` | `@react-three/fiber` |
| --- | --- | --- | --- | --- |
| `@react-three/fiber` | 9.7.0 | `>=19 <19.3` | `>=0.156` | — |
| `@react-three/fiber` | 9.0.0 | `^19.0.0` | `>=0.156` | — |
| `@react-three/drei` | 10.7.8 | `^19` | `>=0.159` | `^9.0.0` |
| `@react-three/postprocessing` | **3.0.5** | `^19.2.0` | **`>= 0.182.0`** | `>=9.7.0` |
| `@react-three/postprocessing` | **3.0.4** | `^19.0` | **`>= 0.156.0`** | `^9.0.0` |
| `next` | 15.5.23 / 16.3.0 | `^18.2.0 \|\| ^19.0.0` | — | — |

Three things fall out of that table, and two of them are traps.

**Trap 1 — `@react-three/postprocessing@3.0.5` drags three.js with it.** Only
the newest patch raised its three.js floor to `>= 0.182.0`. Taking `latest`
therefore forces `three` from `0.171.0` to at least `0.182.0` — **11 minor
releases and 13 months of three.js drift**, in the same change as a React major
and an R3F major. three.js minors routinely retune colour management, tone
mapping and light units; those do not fail a build, they **change how the scene
looks**, silently, in a product whose entire value is how the scene looks.

The escape is one line: pin **`@react-three/postprocessing@3.0.4`**, whose floor
is `>= 0.156.0`. The repo's `three@0.171.0` satisfies it. **The three.js bump
becomes a separate, later, independently reversible change** instead of a
passenger on the React upgrade. This single pin is the highest-leverage
decision in the whole document.

**Trap 2 — the React version window is narrow and closing.** `fiber@9.7.0`
caps React at `<19.3` while `postprocessing@3.0.5` floors it at `^19.2.0`. The
legal window with `latest` everywhere is **React 19.2.x only**. Latest React is
`19.2.8`, so it works today, but a React 19.3 release makes `fiber@9.7.0`
illegal until pmndrs publishes. Pinning `postprocessing@3.0.4` widens the floor
back to `^19.0`, which is a second reason to prefer it.

**Not a trap — `next` does not force React 19 at the peer level.** Both 15.5.23
and 16.3.0 declare `^18.2.0 || ^19.0.0`. But the official Next 15 upgrade guide
is explicit and overrides the manifest: *"The minimum versions of `react` and
`react-dom` is now 19."* Treat React 19 as **mandatory from Next 15**, and read
the loose peer range as legacy Pages-Router tolerance, not permission.

**Maturity, since "is v9 too new" is the obvious worry.** `@react-three/fiber`
**9.0.0 shipped 2025-02-19** — eighteen months ago — and has had **19 stable
9.x releases** since, the newest (`9.7.0`) on 2026-07-31. `@react-three/drei`
**10.0.0 shipped the same day**, with **33 stable 10.x releases** since, the
newest on 2026-08-05. This is not a bleeding edge. It is a line that has been
stable longer than this project has existed.

---

## Next.js: what actually applies to this repo

The repo's Next surface is unusually small, and that is the good news that
makes the rest survivable. Imports, counted: `next/link` ×5, `next` (types) ×4,
`next/navigation` ×2, `next/image` ×1, `next/font/google` ×1. **No route
handlers. No middleware. No `next/server`. No server actions. No `next/cache`.**
49 of 52 `.tsx` files carry `"use client"`.

Almost the entire Next 15 and Next 16 breaking-change surface is server-side.
This app barely has a server side.

### The 14 → 15 hop

| Breaking change | Applies here? |
| --- | --- |
| **Async `params` / `searchParams`** | **YES — 3 files.** The only real hit |
| React 19 minimum | **YES** — the whole point |
| `fetch` no longer cached by default | No — no server-side `fetch` |
| `GET` Route Handlers no longer cached | No — no route handlers |
| Client Cache: page segments not reused on `<Link>` | **Behavioural, yes.** Data is fetched client-side in `useEffect`, so a back-navigation refetches. Not a break; a perceived-latency change worth watching |
| `next/font` ← `@next/font` | No — already `next/font/google` |
| `runtime: 'experimental-edge'` | No |
| `NextRequest.geo` / `.ip` removed | No |
| Speed Insights auto-instrumentation removed | No |
| `bundlePagesExternals` / `serverComponentsExternalPackages` renames | No |

### The 15 → 16 hop

Next 16 is where sync `params` stops being tolerated: *"Starting with Next.js
16, synchronous access is fully removed."* Next 15 keeps a deprecation window
with a dev warning; Next 16 does not.

| Breaking change | Applies here? |
| --- | --- |
| Sync request APIs **removed** (not just deprecated) | **YES — the same 3 files, now mandatory** |
| **Turbopack is the default for `next dev` AND `next build`** | **YES, by default.** Mitigated: the repo has **no custom webpack config**, which is the documented cause of hard build failures. Opt out with `next build --webpack` if needed |
| `next lint` **removed**; `next build` no longer lints | **YES.** `package.json` still has `"lint": "next lint"`. Codemod: `next-lint-to-eslint-cli` |
| `@next/eslint-plugin-next` defaults to **flat config** | **YES** — pairs with the ESLint 8 → 9 move |
| `next/image`: `qualities` default → `[75]`, `imageSizes` drops 16, `minimumCacheTTL` 60s → 4h, redirects capped at 3, local-IP blocked | **Marginal** — one `<Image>`, in `layout.tsx`. Worth an eyeball, not a project |
| `middleware` → `proxy` | No |
| Scroll-behaviour override removed unless `data-scroll-behavior="smooth"` | **No** — verified: no `scroll-behavior` rule anywhere in `src/` |
| Parallel-route `default.js` now required | No |
| AMP removed | No |
| `serverRuntimeConfig` / `publicRuntimeConfig` removed | No |
| `experimental.ppr` / `dynamicIO` / `useCache` removed | No |
| `revalidateTag` needs a second argument | No |
| Node ≥ 20.9, TypeScript ≥ 5.1 | **Satisfied** — CI runs Node 24, repo is TS 5.7 |
| Browser floor Chrome/Edge/Firefox 111+, Safari 16.4+ | Satisfied for a WebGL2 app |

Two Next 16 items deserve their own line because they are easy to miss:

**`next build` no longer prints `size` and `First Load JS`.** Vercel removed
them as inaccurate for RSC architectures. This repo's own performance notes are
denominated in that metric — *"436–450 kB First Load JS on the 3D routes"*. If
the fleet moves to 16, **the number the frontend has been optimised against
stops existing**, and bundle-size regressions become invisible unless something
replaces it. That is a measurement loss, not a code break, and it is the kind
that is noticed a year late.

**Both `next dev` and `next build` default to Turbopack.** The repo loads `.glb`
models and raw GLSL strings; those are plain static imports and template
literals, not loaders, so nothing obviously breaks — but this is a whole new
bundler for a heavy 3D dependency graph and it belongs in the "verify in a
browser, not in CI" bucket.

### The exact code change, all three files

Both patterns are in the official guide. **Server component** —
`app/universe/share/worlds/[shareSlug]/page.tsx` and its `nature` twin:

```tsx
type PageProps = { params: Promise<{ shareSlug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareSlug } = await params
  return buildShareWorldMetadata("universe", shareSlug)
}

export default async function UniverseShareWorldPage({ params }: PageProps) {
  const { shareSlug } = await params
  return <ShareWorldView shareSlug={shareSlug} family="universe" />
}
```

**Client component** — `app/worlds/[worldId]/page.tsx`, which is `"use client"`
and therefore cannot `await`:

```tsx
"use client"
import { use } from "react"

type PageProps = { params: Promise<{ worldId: string }> }

export default function WorldPage(props: PageProps) {
  const { worldId } = use(props.params)
  // ...unchanged
}
```

Codemod: `npx @next/codemod@canary next-async-request-api .` — and `npx next
typegen` generates `PageProps<'/worlds/[worldId]'>` helpers if preferred over
hand-written types.

**Three files. That is the entire Next-side code change.** The scale of this
migration is not in Next.js.

---

## React 19: what actually applies

Checked against the source, not assumed. Two of these were resolved by grep and
came back clean:

| React 19 change | Applies here? |
| --- | --- |
| `propTypes` / `defaultProps` on function components removed | No — TypeScript throughout |
| String refs removed | No — none |
| `ReactDOM.render` / `hydrate` / `findDOMNode` removed | No — App Router |
| `react-dom/test-utils` `act` moved to `react` | No — no render tests exist (§The blind spot) |
| **`useRef` now requires an argument** | **No — verified: zero `useRef()` calls with no argument** |
| **Ref callbacks must not return a value** | **No — verified: 3 ref callbacks, all block-bodied (`ref={(x) => { … }}`), none implicit-return** |
| `element.ref` deprecated in favour of `element.props.ref` | No — not accessed |
| Uncaught errors → `window.reportError` instead of re-throw | Cosmetic; changes what appears in the console |
| **StrictMode: `useMemo`/`useCallback` reuse first-render results** | **YES — and it is load-bearing. See the R3F section** |
| **Suspense: fallback commits immediately, siblings pre-warm after** | **YES — the highest-risk item in this document** |

### Why the Suspense change is the risk

React 19 changed the rule to: *"when a component suspends, React will
immediately commit the fallback of the nearest Suspense boundary without waiting
for the entire sibling tree to render. After the fallback commits, React
schedules another render for the suspended siblings to 'pre-warm' lazy requests
in the rest of the tree."*

This repo does not merely use Suspense. It **builds its loading choreography on
the precise timing of Suspense**, and says so in its own comments:

- `features/scene-renderers/registry.ts` uses `React.lazy` **deliberately
  instead of `next/dynamic`**, with a comment explaining that `next/dynamic`
  *"does not suspend"*, which would let the ready-signal mount early, *"lift the
  opacity veil and show an empty canvas until the chunk landed."*
- `components/UniverseCanvas.tsx` mounts `SceneReadySignal` **inside** the same
  Suspense boundary so that its first `useFrame` means *"textures resolved and
  pixels are on screen"* — the moment the canvas may fade in.
- Suspending inside that boundary comes from **three independent sources**: the
  lazy renderer chunk, `useGLTF`/`useTexture` (drei), and `useLoader` (R3F) —
  used across 8+ components.

A change to *when the fallback commits relative to sibling rendering* is exactly
the kind of change that turns "fade in when the scene is ready" into "fade in
over an empty canvas, then pop". It will not fail typecheck. It will not fail a
unit test. **It is visible only to a human looking at a loading screen**, or to a
screenshot taken at the right moment.

This is the single item that most deserves a manual, deliberate, both-families,
desktop-and-mobile verification pass.

---

## React Three Fiber v8 → v9: what actually applies

From the official v9 migration guide, item by item:

| v9 change | Applies here? |
| --- | --- |
| Global JSX namespace → `ThreeElements` interface | **No — verified: the repo never calls `extend()` and declares no custom elements.** This is the change most v9 migration write-ups lead with, and it costs this repo nothing |
| `Props` renamed to `CanvasProps` | No — not imported |
| Hardcoded `MeshProps` / `Object3DNode` exports removed | **No — verified: zero occurrences** |
| `useLoader` accepts loader instances | Additive |
| `gl` callback may return a promise | Additive |
| **Automatic sRGB conversion of texture props removed** | **No — and this is the good news below** |
| **StrictMode now properly inherited from the parent** | **YES — the real work** |

### The scariest change costs nothing here, and the reason is in the repo

"Automatic sRGB conversion of texture props has been removed" is a **silent
colour regression** for most apps: every colour map loaded through `TextureLoader`
suddenly samples as linear, and the whole scene goes washed-out and flat.

This repo already fought that battle and won it the hard way. From
`features/scene-renderers/shared/textureQuality.ts`:

> *"three's `TextureLoader` leaves textures in `NoColorSpace`, so our
> sRGB-encoded JPGs were being sampled as if linear — washed-out, low contrast.
> Color maps must be tagged `SRGBColorSpace` (data maps — normal, roughness,
> alpha — must NOT be)."*

`applyColorTextureQuality()` sets `texture.colorSpace = SRGBColorSpace`
explicitly, and it is called at **every** `useLoader(TextureLoader, …)` colour
site — `BinarySun.tsx`, `Skybox.tsx`, `SolarPlanet.tsx`, `Sun.tsx`. Procedural
textures set it too (`gasGiantTexture.ts:228`, `planetRingTexture.ts:95`), and
`ForestTerrain.tsx:221` sets `NoColorSpace` on the relief map on purpose. The
only `useTexture` call loads a **normal map and an ARM map** — data maps, which
must not be sRGB in either version.

**The app never depended on the automatic conversion, so removing it changes
nothing.** That is a direct, evidence-backed answer to *"các hàm quan trọng có
tái sử dụng được không"* for the most dangerous single item on the list.

### What does cost work: StrictMode reaching inside the Canvas

`next.config.mjs` sets `reactStrictMode: true`. Under R3F v8, StrictMode was
**not** inherited into the `<Canvas>` subtree, so none of the scene renderers
have ever run under it. v9 fixes that — and the guide's own words are that it
*"may expose side-effect bugs"*.

Combine that with React 19's StrictMode rule — *"`useMemo` and `useCallback`
will reuse the memoized results from the first render during the second
render"* — and one specific pattern in this repo becomes hazardous:

```tsx
const rockGeometries = useMemo(() => [...], [seed]);   // created once
useEffect(() => {
  return () => { rockGeometries.forEach((g) => g.dispose()); };  // disposed on cleanup
}, [rockGeometries]);
```

The StrictMode sequence is mount → cleanup → mount. The cleanup **disposes** the
geometry; the second mount **reuses the same memoized object**, now disposed.
The mesh then renders against a dead `BufferGeometry`.

The exact sites, found by grep — this is the complete list:

- `solar-system/AsteroidBelt.tsx:234` — `rockGeometries.forEach(g => g.dispose())`
- `solar-system/Comet.tsx:204` — `nucleusGeometry.dispose()`
- `solar-system/ProceduralMoons.tsx:119` — `geometry.dispose()`
- `solar-system/SolarPlanet.tsx:246` — `ringGeometry?.dispose()`
- `solar-system/SolarPlanet.tsx:262` — `proceduralRingGeometry?.dispose()`

**Stated honestly, and this matters for how much to panic:** StrictMode's
double-invocation is **development-only**. Production builds do not double-mount,
so this cannot take the live site down. What it can do is make `npm run dev`
look catastrophically broken across the whole solar-system family, at exactly
the moment the team is least sure whether the upgrade or their own code is at
fault — and send someone "fixing" things that were never wrong. Budget time for
it; do not budget fear.

The remedy is standard and small: allocate in a `useRef`/lazy initialiser rather
than `useMemo`, or drop the disposal effect and let R3F's own disposal handle it.
Five files.

### Per-file verdict for the 3D layer

| Group | Files | Verdict |
| --- | --- | --- |
| Uses only `useFrame` / `useThree` / `ThreeEvent` | ~20 | **Unchanged.** No v9 item touches these APIs |
| Uses `useGLTF` / `useTexture` / `useAnimations` | 8 | **Unchanged in code**, but re-verify visually — they are the Suspense sources |
| Raw GLSL `<shaderMaterial>` | `SizedStarPoints.tsx`, `NebulaCloudPoints.tsx` | **Unchanged.** GLSL is untouched under `WebGLRenderer`; only a WebGPU move would touch them |
| `onBeforeCompile` shader injection | `forest/forestModels.ts` | **Unchanged by R3F v9 — but the most fragile file in the repo across a three.js bump.** See below |
| `useMemo` + dispose-in-cleanup | the 5 sites above | **Needs thought** — the StrictMode item |
| `PostEffects.tsx` (8 effects) | 1 | **Version-pin decision**, not a code edit — see Trap 1 |

**Roughly 30 of ~35 3D files need no edit at all.** That is the honest answer to
the reuse question, and it is a much better answer than the migration's
reputation suggests.

### The one file that can fail silently and take the forest with it

`features/scene-renderers/forest/forestModels.ts:279` does not write its own
shader. It **patches three.js's built-in one**:

```ts
material.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    [ "#ifdef USE_MAP",
      "  vec4 sampledLeafColor = texture2D( map, vMapUv );",
      /* … collapse to luminance, remap, multiply onto instance colour … */ ].join("\n")
  );
};
```

This depends on two **internal** details of three.js: the chunk name
`#include <map_fragment>` and the varying `vMapUv`. Neither is public API.
Neither is covered by semver.

The failure mode is what makes it dangerous. `String.prototype.replace` with no
match **returns the original string and throws nothing**. If a future three.js
renames the chunk or the varying, the injection silently becomes a no-op, the
foliage loses its seasonal recolouring, and the app builds clean, typechecks
clean, passes all 217 tests and deploys green — with the forest family's leaves
quietly the wrong colour.

Two consequences:

1. **This is the strongest single argument for the screenshot baseline**, and
   for keeping the three.js bump on its own PR. It is exactly the class of bug
   nothing in this repo's CI can see.
2. **It is a hard blocker for WebGPU**, not merely work. `onBeforeCompile` on a
   built-in material is a `WebGLRenderer` mechanism; under `WebGPURenderer` the
   equivalent is a TSL node graph, which is a rewrite of the technique rather
   than a translation of the shader. Track D counted this file as "rewrite in
   TSL" and was right to.

A cheap defence, worth more than its size: make the replacement assert it
matched. Three lines, and it converts a silent visual regression into a loud
console error the moment three.js moves underneath it.

---

## The blind spot: nothing in CI can see the scene

This is the finding that should govern the plan, and it has nothing to do with
any library version.

- **217 unit tests across 20 files.** All of them test pure modules: seeded
  math, scene derivation, routing, form state, the audio graph, API shaping.
- **Zero component-render tests.** Verified: no `@testing-library`, no
  `render(` anywhere in `src/`.
- **Zero end-to-end or visual tests.** Verified: no Playwright anywhere in the
  repository.
- CI for the web app runs `typecheck`, `lint`, `test`, `build` — **all four are
  blind to what the canvas draws.**

So the suite is excellent at protecting **exactly the code that cannot break in
this migration** (pure TypeScript, no React, no three.js) and provides **zero
coverage of the code that will** (components, Suspense timing, GPU resources,
post-processing, colour).

Two consequences follow, and they are not optional:

1. **A green CI run means nothing here.** It will be green through a scene that
   renders black, a veil that lifts early, washed-out colour, or bloom that
   blew out. Treating green as a go signal is the specific way this migration
   ships a broken product.
2. **The cheapest real mitigation is a screenshot pass, not more unit tests.**
   A handful of Playwright screenshots — solar system and forest, desktop and
   375 px, before and after — would turn every silent risk in this document
   into a visible diff. That work is worth more than any single version bump
   here, and it is worth doing **before** the upgrade, so there is a baseline
   to compare against. A baseline captured after the upgrade proves nothing.

---

## WebGPU: an honest verdict

### Verified browser reality, 2026-08-12 (caniuse)

**85.56 % global support.** Chrome 113+, Edge 113+, Samsung Internet 24+,
Opera 99+.

But the detail matters more than the headline:

- **Firefox is still disabled by default** — through version 156 on desktop and
  153 on Android. Not "shipped in 141" as this repo previously recorded.
- **Safari on macOS shows only partial support even at 26.0+.** iOS Safari
  26.0+ is full.
- The 85 % is carried almost entirely by Chromium.

For a public, link-shared product — and share links are a core feature here —
"most visitors, plus a fallback path that must be exercised on the rest" is the
accurate framing, not "supported".

### The verdict is unchanged, and it is: not yet

Nothing found this session moves the conclusion already recorded in Track D:

- The scenes are procedural, low-poly and already instanced. They are nowhere
  near the draw-call or compute ceilings where WebGPU wins.
- The measured frontend bottleneck is **bundle size and cold start**, neither
  of which WebGPU improves.
- **Seeded determinism is a product promise** — *"same seed, same scene,
  forever"*. Every share link ever issued is a claim about pixels. A renderer
  swap that shifts a float breaks that claim retroactively, and there is
  currently no screenshot baseline that would even detect it.

WebGPU becomes interesting when City arrives with denser geometry, or when a
feature needs compute. Today it is a by-product of a security upgrade, not a
reason for one — and it should be the **last** step, behind a
`navigator.gpu` flag, after a screenshot baseline exists.

---

## Corrections to `platform-evolution-research.md` §Track D

Three statements there are wrong and should not be planned against:

| Track D says | Verified reality |
| --- | --- |
| "three.js **r171** (September 2025)" | `three@0.171.0` was published **2024-11-29**. Off by ~10 months, which also makes the version sound far fresher than it is — it is now 14 minors behind |
| "Browser support: Chrome 113+, **Firefox 141+**, Safari 26" | Firefox is **disabled by default** through 156 desktop / 153 Android (caniuse, 2026-08-12) |
| "`three` — **unchanged**, already sufficient" | True only with `@react-three/postprocessing@3.0.4`. With `3.0.5` (`latest`) the peer floor is `three >= 0.182.0`, forcing an 11-minor bump |
| "`next` — 3 high advisories" | **8 high** in `myunivokai-web` today, of which the `next` entry alone aggregates **21 advisories** |

Track D's shader inventory, on the other hand, was right to list
`forest/forestModels.ts` — and understated it. See the next section.

---

## Two candidate routes

### Route A — Next 15.5.23, one major hop *(recommended)*

```
next            14.2.23 → 15.5.23
react/react-dom 18.3.1  → 19.2.x
@react-three/fiber      8.18.0 → 9.7.0
@react-three/drei       9.122.0 → 10.7.8
@react-three/postprocessing 2.19.1 → 3.0.4   ← pinned, NOT latest
three                   0.171.0 (unchanged)
eslint / eslint-config-next     8.x (unchanged — 15.5.23 accepts ^8 || ^9)
tailwindcss             3.4.17 (unchanged)
```

- Closes **all 21** `next` advisories — every request-path CVE. Leaves the
  build-time `postcss`/`nanoid` pair; see §The catch.
- Lands `myunivokai-web` on **the exact stack `myunivokai-admin` already runs**,
  which collapses two toolchains into one and gives the team a working reference
  implementation inside its own repo.
- Keeps sync `params` legal (deprecated, dev warning) — so the three-file change
  can be made deliberately rather than under build-failure pressure.
- **Does not** move to Turbopack, does not touch ESLint, does not touch
  Tailwind, does not touch three.js. Every one of those becomes a separate,
  separately revertible change.
- Remaining work is then exactly: async `params` (3 files) + the StrictMode
  dispose pattern (5 files) + a visual verification pass.

### Route B — Next 16.3.0, both hops at once

Everything in Route A, plus: sync `params` becomes fatal, Turbopack becomes the
build tool, `next lint` disappears, ESLint must move to 9 + flat config, and the
`First Load JS` metric the team optimises against stops being printed.

It also does one thing Route A cannot: it replaces `next`'s pinned
`postcss@8.4.31` with `8.5.23`, which is the only way to make
`npm audit --omit=dev --audit-level=high` exit 0.

Route B is not unreasonable — the repo has no custom webpack config, which
removes Turbopack's main failure mode, and Node 24 and TS 5.7 already satisfy
the floors. It is simply **more simultaneous unknowns in the one app with no
visual test coverage**, in exchange for closing a build-time advisory with no
attacker path in this deployment.

**Recommendation: Route A now, Route B on its own PR once a screenshot baseline
exists to verify it against.** If the owner would rather satisfy
`S1-SECURITY-001` literally in one move, Route B is defensible — but then the
screenshot baseline stops being optional, because Route B changes the bundler,
the linter and the framework in the app nothing can visually test.

### Suggested order, either route

1. **Playwright screenshot baseline first, on the current stack.** Both
   families, desktop + 375 px, loading state and settled state. Without this
   step nothing below can be verified, only hoped.
2. Async `params` — 3 files. Safe on 14, so it can land and merge alone.
3. The version bump, with `postprocessing` pinned to `3.0.4`.
4. Fix the five StrictMode dispose sites.
5. Re-shoot the screenshots. Diff. **Look at the images**, do not read the markup.
6. Only then: three.js 0.171 → 0.185, on its own PR, re-shooting again — this
   is the change most likely to shift colour and lighting silently, and the one
   that can no-op `forestModels.ts` without a single error. Add the
   match-assertion to that file *before* bumping, so it reports rather than
   hides.
7. Only then, and only if there is a reason: Next 16, and after that WebGPU
   behind a `navigator.gpu` flag.

Rollback, at every step: Vercel keeps previous deployments and can promote one
back. That is the real safety net, and it argues for **small, separately
promotable deployments** rather than one heroic PR — which is the same argument
as the repo's own *"one concern per PR"* rule, applied to risk instead of review.

---

## What must not happen

- **`npm audit fix --force`.** It installs `next@16.3.0` and
  `eslint-config-next@16.3.0` in one unreviewed step, on the reasoning that
  `latest` is the fix. The minimum sufficient fix is `15.5.23`.
- **Taking `@react-three/postprocessing@latest` without thinking.** It silently
  drags three.js forward 11 minors inside a React upgrade, and three.js minors
  change how things look, not whether they compile.
- **Treating a green CI run as verification.** Typecheck, lint, 217 unit tests
  and a successful build are all blind to the canvas.
- **Upgrading and screenshotting afterwards.** A baseline taken after the change
  proves the app renders; it cannot prove it renders *the same*.
- **Doing the three.js bump in the same PR as the React bump.** If the colours
  shift, there would be no way to tell which change did it.
- **Starting with WebGPU.** It is last, it is flagged, and it is gated on a
  visual baseline existing.

---

## What is still unverified

A seven-dimension parallel research run was launched for this document and
**all eight agents failed on an account session limit**, returning nothing. What
is written above therefore comes from the npm registry, the official upgrade
guides, caniuse, and direct reading of this repository — which covers the
decision-critical parts, but leaves these open. **Do not treat their absence as
"no problem found".**

| Open item | Why it matters | How to close it |
| --- | --- | --- |
| Open R3F v9 / drei v10 regressions in the wild | 19 and 33 stable releases suggest health, but issue trackers were not read | Search the pmndrs issue trackers for v9 regressions before starting |
| three.js **r171 → r185 migration entries** | 14 minors of colour/tone-mapping/light-unit changes; the highest silent-visual-risk item in the whole plan. Specifically: whether `#include <map_fragment>` or the `vMapUv` varying changed anywhere in that range, which would silently no-op `forestModels.ts` | Read the official three.js migration guide for every release in the range — required before step 6 |
| `@react-three/postprocessing` under `WebGPURenderer` | If `EffectComposer`/`Bloom`/`N8AO` do not work on WebGPU, the app loses its look on that path and WebGPU is off the table entirely | Verify before any WebGPU work is scheduled |
| `WebGPURenderer` production status and the completeness of its WebGL2 fallback | Track D's "production-ready" claim was never verified and its neighbouring facts were wrong | Read the three.js docs/release notes directly |
| Vercel Node runtime defaults, and whether an existing project auto-upgrades | Next 16 needs Node ≥ 20.9; Vercel supports Next 16 (its docs describe 16 behaviour, updated 2026-06-26), but the runtime default was not confirmed | Check the project's runtime setting in the Vercel dashboard before Route B |
| Hobby-tier build limits for a heavy 3D bundle | Turbopack + three.js + drei + `.glb` assets is a large build | Watch the first Route B build |
| `output: "standalone"` on Vercel | Set in `next.config.mjs`, but the web app is deployed on Vercel, where the default output is expected. Not mentioned in the 16 guide | Confirm whether to drop it |

---

## Sources

All retrieved 2026-08-12.

- Next.js 16 upgrade guide — https://nextjs.org/docs/app/guides/upgrading/version-16 (doc version 16.3.0, updated 2026-08-03)
- Next.js 15 upgrade guide — https://nextjs.org/docs/app/guides/upgrading/version-15 (updated 2026-08-06)
- React 19 upgrade guide — https://react.dev/blog/2024/04/25/react-19-upgrade-guide
- React Three Fiber v9 migration guide — https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide
- WebGPU browser support — https://caniuse.com/webgpu
- Next.js on Vercel — https://vercel.com/docs/frameworks/full-stack/nextjs (updated 2026-06-26)
- npm registry: `next`, `react`, `react-dom`, `three`, `@react-three/fiber`,
  `@react-three/drei`, `@react-three/postprocessing`, `eslint-config-next`,
  `postcss` — versions, publish dates and `peerDependencies` read directly
- `npm audit --json` in `apps/myunivokai-web` and `apps/myunivokai-admin`
- This repository, read directly: `package.json` ×2, `next.config.mjs`,
  `.github/workflows/ci.yml`, `src/app/**`, `src/features/scene-renderers/**`,
  `src/lib/**`
