# Source-grounded engineering backlog

> **Document status:** Active prioritized backlog
> **Last source review:** 2026-07-18

This is the current task selection source. Architecture rationale lives in
`notes/vision/`; implementation mechanics live in `notes/be/` and `notes/fe/`.

## P0-DEP-001 — Verify the Render fleet end to end

Status: Ready
Priority: P0

As a platform operator,
I want deployment evidence from the real Render/Neon environment,
so that committed configuration is not mistaken for a verified production
system.

Scenario: Prove the four-service topology

Given all `sync: false` values and two Neon logical databases are configured
When the operator deploys peers, gateway, then web and follows the runbook
Then all liveness/readiness checks pass
And direct peer business calls return 401
And create/get/regenerate/select/publish/share pass for both families
And browser API traffic uses only the gateway host.

Tasks:

- [ ] Execute `notes/ops/render-deployment.md` against the real services.
- [ ] Record service URLs, commit SHA, timestamp, and pass/fail without secrets.
- [ ] Keep status “pending verification” if any mandatory smoke step is absent.

## P0-FE-001 — Upgrade the supported frontend framework baseline

Status: Ready
Priority: P0
Suggested branch: `refactor/fe/next-supported-major`

As a platform operator,
I want the production dependency audit to pass,
so that a known vulnerable framework tree is not declared production-ready.

Scenario: Upgrade without behavior regression

Given the current app uses Next 14/React 18 and the production audit fails
When the framework is migrated through supported majors using official upgrade
guides and reviewed codemods
Then typecheck, lint, tests, build, Docker standalone smoke, and both share
metadata routes pass
And `npm audit --omit=dev --audit-level=high` exits successfully
And no `npm audit fix --force` is used as an unreviewed migration strategy.

Source evidence:

- `clients/web-client/package.json`
- `notes/ops/render-deployment.md`
- [Official Next.js upgrade guides](https://nextjs.org/docs/app/guides/upgrading)

Tasks:

- [ ] Migrate Next 14 → 15 and React 18 → 19 with route/metadata tests green.
- [ ] Migrate 15 → 16, replace removed `next lint` workflow with explicit ESLint.
- [ ] Review App Router async params and Docker/Node requirements.
- [ ] Capture before/after audit and build output.

## P0-CONTRACT-001 — Make scene and public API contracts executable

Status: Ready
Priority: P0
Suggested branch: `feat/repo/executable-scene-contracts`

As a developer adding scene families,
I want one validated contract chain from Go output to frontend input,
so that schema drift fails CI before stored worlds or renderers break.

Scenario: Validate both family envelopes

Given a fixed Universe or Forest builder fixture
When CI serializes and validates it
Then it matches its family JSON Schema and declared `schemaVersion`/`sceneType`
And generated or checked frontend types discriminate the two families
And legacy Universe configs without `sceneType` normalize to solar-system.

Scenario: Describe the browser-facing API

Given the gateway publishes `/api/universe/*` and `/api/nature/*`
When the public OpenAPI contract is validated
Then it contains the actual gateway-prefixed routes and response/error shapes
And it is not the current health-only placeholder.

Source evidence:

- `contracts/openapi.yaml` currently has only `/api/v1/healthz`
- `contracts/schemas/world-scene-config.schema.json`
- `contracts/scenes/forest-scene-config.schema.json`
- `clients/web-client/src/lib/types.ts` and `lib/api.ts`

Tasks:

- [ ] Add `sceneType: "solar-system"` to new Universe configs with legacy FE normalization.
- [ ] Move/alias the Universe schema under `contracts/scenes/` without breaking links.
- [ ] Add Universe golden fixtures and validate both families against JSON Schema.
- [ ] Replace the placeholder public OpenAPI contract with gateway-prefixed paths.
- [ ] Generate or consistency-test FE types; validate API payloads once at the normalizer boundary.

## P1-FE-001 — Lazy-load each scene renderer family

Status: Ready
Priority: P1
Suggested branch: `feat/fe/lazy-scene-renderers`

As a visitor viewing one family,
I want to download only that family's renderer code,
so that adding new families does not make every page heavier.

Scenario: Load a Universe world

Given the registry contains Universe and Forest renderers
When a fresh browser opens a Universe-only world
Then the Forest renderer chunk is not requested before the family is selected
And the existing loading veil covers the async renderer boundary.

Tasks:

- [ ] Replace static family imports with client-safe dynamic imports.
- [ ] Preserve the sceneType-first fallback behavior for legacy Universe configs.
- [ ] Add a reproducible bundle/network assertion for both families.

## P1-FE-002 — Self-host the Draco decoder

Status: Ready
Priority: P1
Suggested branch: `fix/fe/self-host-draco-decoder`

As a visitor loading Forest,
I want all required runtime decoding assets served by Myunivokai,
so that the scene does not depend on a third-party CDN being available.

Scenario: Decode a Forest model offline from third-party CDNs

Given a Draco-compressed Forest GLB
When the browser loads it with external domains blocked
Then decoder JS/WASM comes from the web-client origin
And the model renders successfully.

Source evidence:

- Forest calls `useGLTF(...)` without a local decoder path.
- Drei documents a CDN default and local-path override:
  [useGLTF](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf).

Tasks:

- [ ] Add versioned decoder files under `public/`.
- [ ] Configure one shared local decoder path before any Forest model loads.
- [ ] Add a browser/network smoke check and document decoder version updates.

## P1-FE-003 — Enforce asset catalog and license budgets

Status: Ready
Priority: P1
Suggested branch: `feat/fe/asset-catalog-quality-gate`

As a maintainer,
I want catalog references, attribution, and size limits checked automatically,
so that a missing or oversized model cannot silently break a scene or deploy.

Scenario: Validate committed 3D assets

Given the Universe and Nature catalogs
When the frontend test suite runs
Then every referenced file exists with allowed extension and nonzero size
And every non-public-domain/CC0 source has required attribution
And documented per-file/family budgets fail with actionable paths.

Tasks:

- [ ] Build a Node/Vitest asset manifest check without loading binary files into test memory unnecessarily.
- [ ] Cover textures, GLBs, HDRIs, and local decoder assets.
- [ ] Record current baseline separately from target budgets; do not hide existing excess.

## P1-FE-004 — Adapt 3D quality to the device

Status: Ready
Priority: P1
Suggested branch: `feat/fe/adaptive-3d-quality`

As a visitor on a weaker device,
I want the scene to stay responsive,
so that high DPR, shadows, particles, and post effects do not crash or freeze
the experience.

Scenario: Recover frame time under load

Given a representative Universe and Forest scene
When measured FPS/frame time remains below the target band
Then the client lowers DPR and expensive family-specific effects in named tiers
And interaction remains responsive
And scene identity, seed, object positions, and saved config do not change.

Scenario: WebGL cannot render

Given WebGL creation/model loading fails or the context is lost
When the canvas cannot recover
Then the page shows a usable accessible fallback with retry/navigation
And the rest of the page does not crash.

Reference:

- [R3F scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Drei AdaptiveDpr](https://drei.docs.pmnd.rs/performances/adaptive-dpr)

Tasks:

- [ ] Define measured high/balanced/low profiles and device test matrix.
- [ ] Wire adaptive DPR plus shadow/post/particle/LOD policy.
- [ ] Add WebGL/model error recovery and reduced-motion behavior.

## P1-BE-001 — Add production observability without sensitive payloads

Status: Ready
Priority: P1
Suggested branch: `feat/be/request-observability`

As a platform operator,
I want latency, error, and saturation signals across gateway and peers,
so that a slow provider, cold peer, database problem, or open circuit can be
distinguished quickly.

Scenario: Trace one failed create request

Given the gateway propagates a safe request ID
When a create call times out or a peer/provider fails
Then logs/metrics identify edge duration, selected upstream, peer duration,
failure taxonomy, and circuit state
And no raw personal input, AI output, API key, DB URL, or gateway secret is
recorded.

Tasks:

- [ ] Define RED metrics and trace/log field policy for all three Go modules.
- [ ] Instrument gateway upstream/circuit/cache/limiter and peer DB/provider stages.
- [ ] Add dashboard/runbook thresholds before claiming an SLO.

## P2-BE-001 — Prepare gateway state for horizontal scaling

Status: Deferred by trigger
Priority: P2

As a platform operator,
I want rate limits and cache semantics to remain predictable after scale-out,
so that adding instances does not silently multiply limits or fragment cache.

Scenario: Scale beyond one gateway instance

Given measured traffic requires more than one gateway instance
When the fleet scales horizontally
Then the documented rate-limit/cache semantics remain true across instances
And shared-state failure degrades explicitly rather than failing open silently.

Tasks:

- [ ] Measure single-instance saturation first.
- [ ] Decide which of limiter/cache/circuit state must be shared; circuit state may remain local by design.
- [ ] Evaluate Redis only after the trigger, with timeout and failure policy.

## P2-BE-002 — Add real Nature AI providers

Status: Deferred by product choice
Priority: P2
Suggested branch when approved: `feat/be/nature-real-ai`

As a Nature user,
I want semantic forest DNA generated from my input by a configured provider,
so that production is not limited to mock presets.

Scenario: Generate valid Nature DNA

Given `AI_PROVIDER=gemini` or `openai` and valid credentials
When Nature creates a world
Then the adapter returns schema-valid `NatureDNA`
And repair/fallback behavior matches the orchestrator contract
And tests still use mock without network calls.

## DISCOVERY-3D-001 — Evaluate City as the next scene family

Status: Discovery
Priority: Discovery

As a returning user,
I want a genuinely different visual medium,
so that the product grows beyond two portraits without only adding cosmetic
variants.

Scenario: Approve a City vertical slice

Given CC0 modular city kits and the existing renderer registry
When a small deterministic block prototype is measured
Then the proposal states backend ownership, schema, layout grammar, interaction,
license, bundle/mobile budget, and product value
And no new service is created without an explicit deploy/load trigger.

Candidate sources:

- [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html)
- [Kenney City Kit Commercial](https://kenney.nl/assets/city-kit-commercial)
- [Kenney City Kit Suburban](https://www.kenney.nl/assets/city-kit-suburban)

Tasks:

- [ ] Write an ADR for ownership: existing peer versus justified new peer.
- [ ] Build a non-production vertical slice with a hard asset/draw-call budget.
- [ ] Compare City against mountain/lake and room stories before approval.

## DISCOVERY-AUTH-001 — Define identity before auth implementation

Status: Deferred
Priority: Discovery

As a future account holder,
I want worlds owned and protected consistently,
so that login adds real privacy and persistence rather than a placeholder
service.

Scenario: Approve an identity contract

Given current worlds are anonymous/localStorage-referenced and peers have no
user columns or authorization
When auth is proposed
Then the proposal defines issuer, subject/claims, world ownership, anonymous
migration, public-share policy, service authorization, and deletion/export
And implementation does not begin until those decisions are approved.

