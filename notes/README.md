# Notes — Myunivokai internal documentation

> **Document status:** Active index
> **Last source review:** 2026-07-18

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
| [fe/source-overview.md](fe/source-overview.md) | How the FE source works (Next.js): routes, the family picker, data flow, state | When working in `clients/web-client` |
| [fe/threejs-scene-architecture.md](fe/threejs-scene-architecture.md) | three.js principles, the sceneType-first renderer registry, how to add a scene type | Before touching any 3D code |
| [fe/universe-render-mechanism.md](fe/universe-render-mechanism.md) | How the **universe** is drawn: 4 model layers, texture/GLB pipelines, determinism | Before adding a universe 3D asset |
| [fe/forest-render-mechanism.md](fe/forest-render-mechanism.md) | How the **forest/nature** scene is drawn: instanced + animated GLBs, seasonal recolor, bird gotchas, **the Sketchfab constraint** | Before adding a forest 3D asset |
| [fe/3d-development-limitations.md](fe/3d-development-limitations.md) | What limits 3D quality and the asset/art-direction strategy options | Background for visual quality work |
| [fe/refactor-plan.md](fe/refactor-plan.md) | Historical FE refactor sequence; stale checkboxes are called out at the top | Context only; use `user-stories/` for current work |
| [be/source-overview.md](be/source-overview.md) | How all three Go modules work: gateway flow, peer APIs, AI, storage, security | For any backend task |
| [be/refactor-plan.md](be/refactor-plan.md) | Historical Universe refactor sequence | Context only; use `user-stories/` for current work |
| [vision/](vision/README.md) | Active peer-service platform plan: Universe, Nature, API Gateway, deployment rationale, contracts, roadmap | Before any architecture decision |
| [ops/render-deployment.md](ops/render-deployment.md) | **Step-by-step Render deploy runbook** (web + gateway + 2 peers, backed by Neon) | When deploying or changing infra |
| [user-stories/](user-stories/README.md) | Source-grounded product stories and prioritized engineering tasks, with Given/When/Then acceptance | Before selecting the next feature branch |
| [design/](design/) | Stitch UI mockups (v1, v2) | When polishing UI |
| [archive/](archive/) | Finished/historical plans (original implementation plan, perf, sky-from-DB, visual-diversity, 3D next-steps) | Reference only |

## Audit snapshot — 2026-07-18

| Document group | Status | Notes |
| --- | --- | --- |
| `coding/*.md` | Active | Matches branch/commit convention and the four CI jobs |
| `be/source-overview.md` | Active | Matches gateway plus two peer services |
| `be/refactor-plan.md` | Historical | Old Universe-only sequence; current work moved to `user-stories/` |
| `fe/source-overview.md` | Active | Matches the family-aware client and one gateway origin |
| `fe/threejs-scene-architecture.md` | Active | Registry exists; the lazy-loading upgrade is still pending |
| `fe/universe-render-mechanism.md` | Active | Matches the solar-system renderer and asset catalogs |
| `fe/forest-render-mechanism.md` | Active | Matches Forest schema 1.2 and current asset pipeline; decoder self-hosting is a pending task |
| `fe/refactor-plan.md` | Needs re-baseline | Several unchecked items already exist in source; do not use its status table as backlog |
| `fe/3d-development-limitations.md` | Reference | Principles remain useful; the room-demo branch references are historical |
| `vision/README.md` | Active | Current platform direction |
| `vision/api-gateway.md` | Implemented | Matches gateway policies and peer credential boundary |
| `vision/backend-plan.md` | Active | Matches service ownership; next gaps are linked to user stories |
| `vision/contracts-and-roadmap.md` | Active | Rewritten from the old monolith/extraction roadmap to current source gaps |
| `vision/deployment.md` | Implemented config | Render config exists; live deployment smoke remains pending |
| `vision/frontend-gateway-consolidation.md` | Implemented | One frontend gateway origin exists in source and deployment config |
| `vision/frontend-plan.md` | Active | Re-baselined: family registry exists, stronger contracts and lazy chunks remain |
| `vision/nature-service-plan.md` | Historical | Decision/round log; its early “future gateway/FE” statements are superseded |
| `vision/visual-diversity.md` | Active | Re-baselined after the Universe diversity rounds and Forest renderer landed |
| `ops/render-deployment.md` | Active runbook | Requires real Render values and post-deploy verification |
| `design/**/DESIGN.md` | Superseded reference | Layout ideas remain; purple/cyan visual language is not the active design system |
| `archive/*.md` | Archived | Historical only |

## Instructions for AI agents

1. Read `coding/` before writing any code or commit.
2. Read `fe/` for FE tasks, `be/` for BE tasks; `vision/` before architecture
   decisions; `ops/render-deployment.md` before deploying.
3. Read `user-stories/` before choosing a branch; acceptance criteria use
   Given/When/Then and must cite source evidence.
4. When you introduce a mechanism worth recording, update the matching overview
   file — do not create duplicate documents. Finished round plans move to
   `archive/`.
5. Update the document's `Last source review` only after comparing it with the
   relevant source, tests, and deployment configuration.
