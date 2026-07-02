# Backend plan — composer registry, then scene services

Part of the [vision folder](README.md). Phase numbers match the
[roadmap](contracts-and-roadmap.md).

## Phase 1 — composer registry inside universe-service

Goal: a second scene family ships as a new Go package + one registry entry,
with zero deployment changes. This phase is pure refactor + one column.

### The SceneComposer interface

`internal/scenes/composer.go` (new package, so composers don't import the
service layer):

```go
// SceneComposer turns theme-agnostic semantics into one family's visual
// numbers. Implementations MUST be pure and deterministic: same input, same
// output, no I/O, no clock, all randomness from seed.NewPRNG(input.Seed).
type SceneComposer interface {
    SceneType() string        // "solar-system", "city", "nature"
    SchemaVersion() string    // version of the family's config schema
    Compose(input ComposeInput) (models.WorldSceneConfig, error)
}

type ComposeInput struct {
    DNA       models.PersonalityDNA
    Seed      string
    VariantNo int
    Input     models.WorldInput
}
```

`ComposeInput` is field-for-field today's `BuildWorldConfigInput` — the
existing `WorldConfigBuilder` is moved to
`internal/scenes/solarsystem.Composer` with `SceneType() == "solar-system"`.
Its output must be byte-identical to today's (locked by a golden-snapshot
test), so every stored world and preview seed survives the refactor.

### Registry and wiring

```go
// internal/scenes/registry.go
func NewRegistry(composers ...SceneComposer) *Registry
func (r *Registry) Compose(sceneType string, input ComposeInput) (models.WorldSceneConfig, error)
func (r *Registry) IsSupported(sceneType string) bool
```

- Unknown `sceneType` → sentinel `ErrUnsupportedSceneType` → handler answers
  400 `VALIDATION_ERROR` (mirrors the existing error-mapping pattern in
  `writeServiceError`).
- `WorldService` receives the registry instead of the single builder;
  `CreateWorld` / `RegenerateVariant` call `registry.Compose(...)`.

### Envelope and database

- `models.WorldSceneConfig` gains a `SceneType` field (JSON `sceneType`).
  `theme` stays: it is the style WITHIN a family (a city can be `nebula`-neon
  or `aurora`-pastel; the palette/mood pipeline is family-independent).
- Migration `000002_scene_type.sql`:

```sql
ALTER TABLE world_variants
  ADD COLUMN scene_type TEXT NOT NULL DEFAULT 'solar-system';
```

- `scene_type` lives on **world_variants**, not worlds (decision D1): the
  same world can then be regenerated as a different medium — variant 1 a
  solar system, variant 2 a city — the "portrait series" product idea, for
  free, on the variant flow that already exists.

### API surface (additive only)

- `POST /worlds` body gains optional `preferredSceneType` (default
  `solar-system`; invalid value → 400 with the field detail).
- `POST /worlds/{id}/variants` body gains optional `sceneType` (default: the
  selected variant's type).
- Every variant in responses carries `sceneType` inside `config` — no new
  response shapes, old clients keep working.

### Composer authoring rules (each new family)

- One package per family: `internal/scenes/city/`, `internal/scenes/nature/`.
- All numbers from `seed.NewPRNG`, all bounds as named constants (per
  [coding-style](../coding/coding-style.md)).
- A `<family>_scene_profile.go` for mood tuning, mirrored by a FE
  `sceneProfiles` module — same sync rule as today's mood profile, with a
  naming convention so the pair is discoverable (see
  [frontend-plan.md](frontend-plan.md)).
- Golden-snapshot test per family: fixed DNA + fixed seed → committed JSON
  fixture. Any diff is a breaking change and must bump `SchemaVersion`.

## Phase 2 — extracting scene services

### Service boundaries

- `services/world-service` — today's universe-service, renamed only when the
  first extraction happens (module path churn is not worth it earlier). Owns:
  worlds, DNA generation (the ONLY AI caller), variants, share slugs, the
  Neon database, and all migrations.
- `services/scene-city-service`, `services/scene-nature-service` — stateless
  composers. Forest / mountains / rivers / lakes start as **themes inside one
  nature service** (decision D4); a family gets its own service only when its
  code or load justifies it.

### Internal compose contract

One endpoint per scene service, JSON over HTTP first:

```txt
POST /internal/v1/compose
Headers: X-Request-Id (propagated), X-Internal-Key (shared secret)
Body:    { "sceneType": "city", "dna": {...}, "seed": "...", "variantNo": 2, "input": {...} }
200:     { "config": { WorldSceneConfig } }
400:     unsupported sceneType / malformed body
```

Request/response schemas live in `contracts/scenes/compose-request.schema.json`
so any implementation language can validate against them.

Client behavior inside world-service (all values named constants):

- Timeout per compose call: 2s (composers are pure math; if it is slower,
  something is wrong).
- Retry once on transport error — safe because compose is idempotent by
  construction.
- On failure: 503 `SCENE_UNAVAILABLE` + `Retry-After`, mirroring the
  `AI_UNAVAILABLE` taxonomy that already exists.
- Response cacheable by `(sceneType, schemaVersion, seed, dnaHash)` — an
  in-memory LRU in world-service is enough; identical regenerate requests
  never re-cross the network.

In Phase 2, world-service keeps acting as the single public API (the
"facade"): scene services are internal-only. No gateway yet (decision D3).

## Language choice — Go vs. Rust (decision D2)

The honest analysis: **composers output numbers, not pixels.** The frontend
does the actual 3D drawing. Today's solar-system composer is a few hundred
arithmetic operations — sub-millisecond. CPU only becomes interesting if we
later bake data server-side: terrain heightmaps, erosion simulation, L-system
forests, mesh/texture generation for the nature family.

| Criterion | Go | Rust |
| --- | --- | --- |
| Fits existing codebase/idioms/CI | ✔ same toolchain, same review habits | ✘ new toolchain, new lint/test stack |
| Container size / cold start (Render free tier!) | ~15 MB image, fast start | comparable (~10 MB) — parity |
| Throughput for JSON-in/JSON-out math | far more than enough | more than enough |
| Heavy procedural generation (noise fields, erosion, mesh baking) | good (gonum; SIMD is painful) | ✔ best-in-class (rayon, glam, noise crates) |
| Team velocity today | ✔ | slower until fluent |

**Recommendation:** every scene service starts in **Go** (template cloned
from universe-service: chi + zerolog + healthz/readyz + Dockerfile.render).
Rust enters under a measurable trigger, not taste:

> If a composer's p95 compose time exceeds **50 ms** or it starts producing
> baked binary assets (heightmaps/meshes), port THAT service to Rust
> (axum + serde + rayon). The JSON contract makes the swap invisible to
> world-service and the FE.

This keeps the door open (the contract is language-neutral by design) without
paying the two-toolchain tax before there is a workload to justify it.
