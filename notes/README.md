# Notes — Myunivokai internal documentation

This folder is the project's single knowledge base for both humans and AI agents.
Rule: shared docs live in the shared folder; FE/BE-specific docs live in their own
folder; operations, design mockups, and finished plans have their own folders.

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
| [fe/refactor-plan.md](fe/refactor-plan.md) | FE production upgrade plan | When doing FE refactor work |
| [be/source-overview.md](be/source-overview.md) | How all three Go modules work: gateway flow, peer APIs, AI, storage, security | For any backend task |
| [be/refactor-plan.md](be/refactor-plan.md) | BE production upgrade plan | When doing BE refactor work |
| [vision/](vision/README.md) | Active peer-service platform plan: Universe, Nature, API Gateway, deployment rationale, contracts, roadmap | Before any architecture decision |
| [ops/render-deployment.md](ops/render-deployment.md) | **Step-by-step Render deploy runbook** (web + gateway + 2 peers, backed by Neon) | When deploying or changing infra |
| [design/](design/) | Stitch UI mockups (v1, v2) | When polishing UI |
| [archive/](archive/) | Finished/historical plans (original implementation plan, perf, sky-from-DB, visual-diversity, 3D next-steps) | Reference only |

## Instructions for AI agents

1. Read `coding/` before writing any code or commit.
2. Read `fe/` for FE tasks, `be/` for BE tasks; `vision/` before architecture
   decisions; `ops/render-deployment.md` before deploying.
3. When you introduce a mechanism worth recording, update the matching overview
   file — do not create duplicate documents. Finished round plans move to
   `archive/`.
