# Sprint 02 user stories — resilience and scale proof

> **Document status:** Planned
> **Sprint starts:** 2026-08-05
> **Last source review:** 2026-07-22

- `S2-OBS-001`: trace one request/job across HTTP, NATS, outbox and databases
  without logging sensitive payloads.
- `S2-SCALE-001`: prove two Gateways share one Redis policy and each domain can
  scale independently without duplicate worlds.
- `S2-FAIL-001`: inject Redis, NATS, AI and database failure and prove every
  accepted job recovers or reaches an explicit terminal failure.
- `S2-SLO-001`: record numeric SLOs, lag/cache/DB/provider metrics, alerts and
  scale triggers from measured load.

Given/When/Then details and verification evidence are completed when Sprint 2
starts; Sprint 2 must not absorb unfinished Sprint 1 deployment verification.
