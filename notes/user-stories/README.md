# User stories and engineering tasks

> **Document status:** Active index
> **Last source review:** 2026-07-22

This folder translates source-grounded product behavior and technical gaps into
branch-sized work. It does not replace architecture docs: each story links to
the source and vision contract it exercises.

## Documents

| Document | Purpose |
| --- | --- |
| [implemented-capabilities.md](implemented-capabilities.md) | What the current product already supports, expressed as verifiable stories |
| [engineering-backlog.md](engineering-backlog.md) | Approved event-driven migration, scale and City epics with Given/When/Then acceptance |

The dated delivery commitments live in [../sprints/](../sprints/README.md).
Sprint 1 is the complete platform migration, including local and production
deployment; it is not a foundation-only sprint.

Approved architecture/feature plans referenced by this backlog:

- [Vision V1 solution architecture](../vision/versions/v1-2026-07-22/solution-architecture.md) — NATS, Redis,
  DNA/family boundaries, data ownership and scale model.
- [City Service implementation plan](../vision/city-service-plan.md) — third
  family, now implemented on the new platform only after Sprints 1–2.

## Story format

```md
## US-AREA-NNN — Short outcome

Status: Planned | Ready | Blocked | Implemented | Verified
Priority: P0 | P1 | P2 | Post-City | Discovery

As a <persona>,
I want <capability>,
so that <value>.

Scenario: <name>

Given <precondition>
When <action>
Then <observable result>
And <additional result>

Source evidence:
- path/to/source

Tasks:
- [ ] One branch-sized implementation step
```

## Rules

- `Implemented` means source and automated checks exist.
- `Verified` additionally requires the real environment or browser/device
  evidence named by the story.
- A story cannot claim an API, provider, deployment, or performance result that
  is absent from source/evidence.
- Every task follows `notes/coding/git-convention.md`; one concern per PR from
  `staging`.
- Given/When/Then describes externally observable behavior. Internal file edits
  belong under Tasks, not under Then.
