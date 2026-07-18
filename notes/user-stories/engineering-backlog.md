# Source-grounded engineering backlog

> **Document status:** Active prioritized backlog
> **Last source review:** 2026-07-19

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

## EPIC-CITY-001 — Deliver City as the third stateful scene family

Status: Approved plan; implementation not started
Priority: P1 after P0 contract/security prerequisites

As a returning user,
I want a high-fidelity personal city generated from my input,
so that Myunivokai adds a genuinely different visual medium rather than a
cosmetic variant of Universe or Forest.

Owner decisions:

- City is owned by an independent `city-service` peer with its own database.
- The web client calls City only through `/api/city/*` on the gateway origin.
- Desktop beauty, sharpness and realism are delivered before mobile/weak-device
  optimization.
- The exact scope and phase exits are defined in
  [city-service-plan.md](../vision/city-service-plan.md).

### CITY-CONTRACT-001 — Make City contracts executable first

Status: Planned
Suggested branch: `feat/repo/city-executable-contracts`

Scenario: Validate a City scene across Go and TypeScript

Given approved semantic `CityDNA` fields and a deterministic City fixture
When CI serializes a builder output and the frontend consumes the envelope
Then the output matches a versioned `CitySceneConfig` JSON Schema
And it declares `sceneType: "city"`
And frontend types/runtime validation discriminate City from Universe/Forest
And invalid AI output or scene output fails before persistence/rendering.

Tasks:

- [ ] Define CityDNA semantics without render coordinates or asset paths.
- [ ] Define CitySceneConfig envelope, district/layout graph and compatibility policy.
- [ ] Add JSON Schema, fixed fixtures and validation tests.
- [ ] Add City paths/components to the public Gateway OpenAPI contract before implementation drifts.

### CITY-BE-001 — Build the stateful City peer

Status: Planned after CITY-CONTRACT-001
Suggested branches: `feat/be/city-service-foundation`, then
`feat/be/city-generation-lifecycle`

Scenario: Complete the City world lifecycle deterministically

Given valid user input reaches `city-service` with the internal gateway credential
When a City world is created, regenerated, selected, published and shared
Then AI produces validated semantic CityDNA only for initial creation
And the seeded builder produces validated CitySceneConfig
And regeneration does not call AI by default
And City data is stored in the City database
And public share responses omit raw sensitive input.

Scenario: Reject direct public bypass

Given a caller reaches the City peer URL without the gateway credential
When it calls a business route
Then the peer rejects the request consistently with Universe and Nature
And health policy remains explicitly documented.

Tasks:

- [ ] Add Go module/config, migrations, repositories and transaction boundaries.
- [ ] Add provider interface, mock provider, orchestrator and repair/validation path.
- [ ] Add deterministic builder with named PRNG streams and golden fixtures.
- [ ] Add lifecycle handlers/services, structured errors, health/readiness and Swagger.
- [ ] Add unit/integration tests using mock AI and an isolated City database contract.

### CITY-EDGE-001 — Add City to gateway, local Docker and Render

Status: Planned after CITY-BE-001
Suggested branches: `feat/be/city-gateway-routing`, then
`feat/repo/city-local-render-deployment`

Scenario: Use one public origin for all three families

Given gateway City upstream configuration is valid
When the browser calls `/api/city/*`
Then the gateway applies CORS, request ID, body limit, rate limit, timeout,
circuit and upstream credential policies
And forwards to `city-service`
And the browser never needs the peer URL.

Scenario: Start and verify the expanded fleet

Given documented local environment values or Render/Neon values
When the operator follows the one-command local flow or deployment runbook
Then web, gateway and all three peers become ready
And City lifecycle smoke passes through the gateway
And a direct City business call without the gateway credential returns 401.

Tasks:

- [ ] Add typed City upstream config and route policies to the gateway.
- [ ] Extend aggregate readiness, failure taxonomy and gateway tests.
- [ ] Extend root Docker Compose, env examples and one-command workflow.
- [ ] Extend `render.yaml`, database matrix, rollout/rollback and smoke runbook.

### CITY-VISUAL-001 — Approve a high-fidelity City scene foundation

Status: Planned; desktop high tier first
Suggested branch: `feat/fe/city-high-fidelity-scene`

Scenario: Render a coherent personal city

Given a fixed CitySceneConfig fixture and approved visual references
When the City renderer loads on the desktop review matrix
Then skyline, districts, roads, buildings, landmark, traffic and lighting map
deterministically from the config
And authored placement avoids visibly invalid roads/facades/props
And PBR materials, shadows, reflection, atmosphere and color grading read as
one coherent city
And owner-approved screenshots establish the high-tier visual baseline.

Scenario: Protect asset provenance and runtime independence

Given the City asset catalog
When catalog validation runs
Then every runtime GLB/texture/HDRI/decoder is self-hosted and exists
And scale, pivot, format, license and attribution checks pass
And low-poly prototype assets are not silently accepted as final
high-fidelity art direction.

Candidate prototype/reference sources:

- [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html)
- [Kenney City Kit Commercial](https://kenney.nl/assets/city-kit-commercial)
- [Kenney City Kit Suburban](https://www.kenney.nl/assets/city-kit-suburban)
- [Poly Haven license](https://polyhaven.com/license)

Tasks:

- [ ] Lock art references, desktop viewport/GPU review matrix and visual checklist.
- [ ] Build deterministic district/road/placement grammar before catalog breadth.
- [ ] Build the PBR asset/material manifest and hero landmark pipeline.
- [ ] Implement lighting, shadow, reflection, atmosphere, camera and motion baseline.
- [ ] Capture size/GPU/draw-call/frame-time facts without reducing approved visual quality yet.

### CITY-FE-001 — Complete the City product flow

Status: Planned after CITY-VISUAL-001 and CITY-EDGE-001
Suggested branch: `feat/fe/city-product-flow`

Scenario: Create and share a City portrait

Given City is available in the family picker
When a visitor creates a City and completes variant selection/publishing
Then all API traffic uses the gateway origin
And the registry lazy-loads the City renderer for `sceneType: "city"`
And view, regenerate, select, publish and public share preserve the City family
And loading/error/metadata behavior matches the existing product contract.

Tasks:

- [ ] Add City picker/input semantics without calling AI from the frontend.
- [ ] Add lazy renderer registration and runtime contract validation.
- [ ] Integrate lifecycle, share route metadata and accessible error states.
- [ ] Add unit/integration/browser and visual-regression coverage.

### CITY-VERIFY-001 — Prove City production readiness for its initial support matrix

Status: Planned after all City implementation stories
Suggested branch: `feat/repo/city-production-verification`

Scenario: Verify rather than infer deployment success

Given City code, migrations, gateway routes and frontend flow are merged
When CI, local Docker and the real Render/Neon smoke run complete
Then the commit SHA, timestamp, environment-safe evidence and pass/fail are recorded
And create/get/regenerate/select/publish/share pass through the gateway
And direct-peer protection passes
And owner-approved high-tier screenshots show no visual regression.

Tasks:

- [ ] Run all Go/FE/contract/asset checks and local Docker smoke.
- [ ] Run Render migration/readiness/lifecycle/share smoke without recording secrets.
- [ ] Mark stories `Verified` only after the evidence exists.
- [ ] Open `POST-CITY-FE-001` only after this story and the high-fidelity baseline pass.

## POST-CITY-FE-001 — Adapt 3D quality to mobile and weak devices

Status: Blocked until City feature completion and production verification
Priority: Post-City
Suggested branch: `feat/fe/adaptive-3d-quality`

As a visitor on a weaker device,
I want the scene to stay responsive,
so that high DPR, shadows, particles, and post effects do not crash or freeze
the experience.

Scenario: Recover frame time under load

Given representative Universe, Forest and approved City high-tier scenes
When measured FPS/frame time remains below the target band
Then the client lowers DPR and expensive family-specific effects in named tiers
And interaction remains responsive
And scene identity, seed, object positions, and saved config do not change
And the approved desktop City high tier does not lose sharpness or art direction.

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
- [ ] Compare the final high tier against the approved City visual-regression baseline.

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
