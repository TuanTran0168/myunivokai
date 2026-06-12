# Notes — Myunivokai internal documentation

This folder is the project's knowledge base for both humans and AI agents.
Rule: shared documents live in the shared folder; FE/BE-specific documents live
in their own folder.

## Structure

| Path | Content | Who should read it |
|---|---|---|
| [coding/git-convention.md](coding/git-convention.md) | Branch naming, commit message format, PR rules | Required before any commit |
| [coding/coding-style.md](coding/coding-style.md) | Code style: no hardcoded values, no abbreviated names | Required before writing code |
| [coding/ci-quality-gates.md](coding/ci-quality-gates.md) | GitHub Actions CI gate for every PR | Before refactor work |
| [fe/source-overview.md](fe/source-overview.md) | How the FE source works (Next.js): routes, data flow, state | When working in `clients/web-client` |
| [fe/threejs-scene-architecture.md](fe/threejs-scene-architecture.md) | three.js principles, scene renderer architecture, customization | Before touching any 3D code |
| [fe/refactor-plan.md](fe/refactor-plan.md) | FE production upgrade plan (8 branches, in order) | When doing FE refactor work |
| [be/source-overview.md](be/source-overview.md) | How the BE source works (Go API): layers, AI providers, determinism | When working in `services/universe-service` |
| [be/refactor-plan.md](be/refactor-plan.md) | BE production upgrade plan (8 branches, in order) | When doing BE refactor work |
| [Myunivokai_Implementation_Plan.md](Myunivokai_Implementation_Plan.md) | Original end-to-end project plan | Reference for direction |
| [stitch_personal_universe_3d/](stitch_personal_universe_3d/) | Stitch UI mockups (7 screens) | When polishing UI |

## Instructions for AI agents

1. Read `coding/` before writing any code or commit.
2. Read `fe/` for FE tasks, `be/` for BE tasks.
3. When you introduce a mechanism worth recording, update the matching
   overview file — do not create duplicate documents.
