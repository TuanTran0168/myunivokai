# Notes — Myunivokai internal documentation

> **Document status:** Active index
> **Last source review:** 2026-07-23

This folder is the project's single knowledge base for both humans and AI agents.
Shared docs live in the shared folder; FE/BE-specific docs live in their own
folder; operations, design mockups, user stories, and finished plans have their
own folders.

## Document status convention

Every Markdown document carries a `Document status` and `Last source review`.
The review date means the document was compared with the repository on that
date; it is not the original creation date.

| Status | Meaning |
| --- | --- |
| Active | Source-grounded documentation that may be used for implementation |
| Implemented | The described mechanism exists; the document remains its contract or rationale |
| Needs re-baseline | Some statements or checklist statuses are stale; use the linked current backlog |
| Historical / archived | Decision or implementation record only; never treat it as the current plan |
| Reference | Useful background or design input, but not a source-of-truth contract |

## Structure

| Path | Content | Who should read it |
| --- | --- | --- |
| [coding/git-convention.md](coding/git-convention.md) | Branch naming, commit message format, PR rules | Required before any commit |
| [coding/coding-style.md](coding/coding-style.md) | Code style: no hardcoded values, no abbreviated names | Required before writing code |
| [coding/ci-quality-gates.md](coding/ci-quality-gates.md) | GitHub Actions CI gate for every PR | Before refactor work |
| [fe/source-overview.md](fe/source-overview.md) | How the FE source works (Next.js): async job flow, routes, family picker, rendering | When working in `apps/myunivokai-web` |
| [fe/threejs-scene-architecture.md](fe/threejs-scene-architecture.md) | three.js principles, the sceneType-first renderer registry, how to add a scene type | Before touching any 3D code |
| [fe/universe-render-mechanism.md](fe/universe-render-mechanism.md) | How the **universe** is drawn: 4 model layers, texture/GLB pipelines, determinism | Before adding a universe 3D asset |
| [fe/forest-render-mechanism.md](fe/forest-render-mechanism.md) | How the **forest/nature** scene is drawn: instanced + animated GLBs, seasonal recolor, bird gotchas, **the Sketchfab constraint** | Before adding a forest 3D asset |
| [fe/forest-realism-roadmap.md](fe/forest-realism-roadmap.md) | **What realism level the forest is at**, the coupled water/wander radii, the animal-jitter fix, what to improve next, perf knobs | Before any "make the forest look better" task |
| [fe/ambient-audio-mechanism.md](fe/ambient-audio-mechanism.md) | How every world gets **music**: public-domain scores, recorded instruments, what the DNA arranges, why three earlier versions shipped verified-and-wrong, and how to audition and measure it | Before touching any audio code or asset |
| [fe/3d-development-limitations.md](fe/3d-development-limitations.md) | What limits 3D quality and the asset/art-direction strategy options | Background for visual quality work |
| [fe/deferred-work-plan.md](fe/deferred-work-plan.md) | Execution record for dynamic family chunks and the forest fidelity metrics, both shipped — including what each plan predicted wrongly | When a plan of yours meets a measurement that disagrees |
| [fe/refactor-plan.md](fe/refactor-plan.md) | Historical FE refactor sequence; stale checkboxes are called out at the top | Context only; use `user-stories/` for current work |
| [be/source-overview.md](be/source-overview.md) | How Gateway, DNA, Universe and Nature communicate through NATS/Redis and own data | For any backend task |
| [be/refactor-plan.md](be/refactor-plan.md) | Historical Universe refactor sequence | Context only; use `user-stories/` for current work |
| [vision/](vision/README.md) | Approved event-driven target plus source/target boundary, NATS, Redis, DNA/family ownership and scale roadmap | Before any architecture decision |
| [vision/versions/v1-2026-07-22/](vision/versions/v1-2026-07-22/README.md) | **Current architecture baseline:** V1 approved 2026-07-22 | Before backend, messaging, data or deployment work |
| [vision/city-service-plan.md](vision/city-service-plan.md) | Approved City peer plan and high-fidelity-first implementation phases; not implemented source | Before any City contract, BE, gateway, asset or FE branch |
| [vision/auth-and-admin-plan.md](vision/auth-and-admin-plan.md) | Proposed **auth-service** and the separate **internal admin app**: why staff auth does not violate the deferred identity decision, how admin reads data three services own, RBAC, token design, phases | Before any auth, admin edge or admin FE branch |
| [ops/render-deployment.md](ops/render-deployment.md) | Current Render background-worker deployment entry point | Before deploying |
| [user-stories/](user-stories/README.md) | Source-grounded product stories and prioritized engineering tasks, with Given/When/Then acceptance | Before selecting the next feature branch |
| [sprints/](sprints/README.md) | Dated Sprint 1–3 commitments, Definition of Done and Sprint 1 deployment guide | Before implementation or deployment scheduling |
| [design/](design/) | Stitch UI mockups (v1, v2) | When polishing UI |
| [references/](references/README.md) | External brand research, Three.js asset sources, licenses and tooling links | Before selecting a name or downloading a 3D asset |
| [archive/](archive/) | Finished/historical plans (original implementation plan, perf, sky-from-DB, visual-diversity, 3D next-steps) | Reference only |

## Audit snapshot — 2026-07-22

| Document group | Status | Notes |
| --- | --- | --- |
| `coding/*.md` | Active | Matches branch/commit convention and the seven CI jobs |
| `be/source-overview.md` | Implemented | Matches Gateway plus DNA/Universe/Nature NATS services; local container lifecycle verified |
| `be/refactor-plan.md` | Historical | Old Universe-only sequence; current work moved to `user-stories/` |
| `fe/source-overview.md` | Active | Matches async polling/recovery, family renderers and one gateway origin |
| `fe/threejs-scene-architecture.md` | Active | Registry exists and is now lazy per family; measured First Load JS recorded in §Family chunks |
| `fe/universe-render-mechanism.md` | Active | Matches the solar-system renderer and asset catalogs |
| `fe/forest-render-mechanism.md` | Active | Matches Forest schema 1.2 and current asset pipeline; decoder self-hosting is a pending task |
| `fe/forest-realism-roadmap.md` | Active | Assessed 2026-07-27 on `feat/fe-be/scene-realism-pass`; the perf budget in it is **unmeasured** |
| `fe/refactor-plan.md` | Needs re-baseline | Several unchecked items already exist in source; do not use its status table as backlog |
| `fe/ambient-audio-mechanism.md` | Active | Assessed 2026-08-05 on `feat/fe/procedural-ambient-audio`; matches the six shipped scores and the measured balance. **Nothing in it has been judged by ear yet** |
| `fe/3d-development-limitations.md` | Reference | Principles remain useful; the room-demo branch references are historical |
| `fe/deferred-work-plan.md` | Both parts implemented | Kept as the execution record; Part B's measurement found a real mesh fold on the landmark ponds |
| `vision/README.md` | Implemented V1 baseline | NATS/Redis/DNA architecture exists; live deployment verification remains |
| `vision/versions/v1-2026-07-22/` | Current approved V1 | Versioned scale, ownership, messaging, data and deployment baseline |
| `vision/api-gateway.md` | Historical | Old HTTP peer gateway; V1 versioned architecture is current |
| `vision/versions/v1-2026-07-22/backend-plan.md` | Approved target | Sprint 1 full backend replacement boundary |
| `vision/versions/v1-2026-07-22/contracts-and-roadmap.md` | Active target | New contract inventory, roadmap, risks and fitness checks |
| `vision/versions/v1-2026-07-22/deployment.md` | Implemented configuration | `render.yaml` now defines Gateway plus three background workers |
| `vision/frontend-gateway-consolidation.md` | Implemented | One frontend gateway origin exists in source and deployment config |
| `vision/frontend-plan.md` | Active | Re-baselined: family registry exists, lazy chunks shipped, stronger runtime contracts remain |
| `vision/nature-service-plan.md` | Historical | Decision/round log; its early “future gateway/FE” statements are superseded |
| `vision/visual-diversity.md` | Active | Re-baselined after the Universe diversity rounds and Forest renderer landed |
| `vision/city-service-plan.md` | Approved product plan with amendment | City moves to Sprint 3 and consumes canonical DNA/NATS |
| `vision/auth-and-admin-plan.md` | Approved with amendments, not implemented | Drafted and amended 2026-08-05: one gateway with an admin route group, Django-style runtime-editable RBAC, and a token/role model that must extend to 3D-web accounts. Six of seven owner decisions settled; token verification strategy still open |
| `ops/render-deployment.md` | Active entry point | Routes operators to the Sprint 1 NATS/Redis deployment guide |
| `sprints/` | Active schedule | Sprint 1 complete migration, Sprint 2 hardening, Sprint 3 City |
| `design/**/DESIGN.md` | Superseded reference | Layout ideas remain; purple/cyan visual language is not the active design system |
| `references/` | Reference catalog | External links are dated research inputs; re-check availability and asset-level licenses before use |
| `archive/*.md` | Archived | Historical only |

## Instructions for AI agents

1. Read `coding/` before writing any code or commit.
2. Read `fe/` for FE tasks, `be/` for BE tasks; `vision/` before architecture
   decisions. Before deploying, choose the runbook that matches the runtime:
   `ops/render-deployment.md` and the dated Sprint 1 deployment guide for the
   current NATS/Redis platform.
3. Read `user-stories/` before choosing a branch; acceptance criteria use
   Given/When/Then and must cite source evidence.
4. When you introduce a mechanism worth recording, update the matching overview
   file — do not create duplicate documents. Finished round plans move to
   `archive/`.
5. Update the document's `Last source review` only after comparing it with the
   relevant source, tests, and deployment configuration.
