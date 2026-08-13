# Delivery sprints

> **Document status:** Active schedule
> **Last source review:** 2026-07-22

The folders include ISO start/end dates so a sprint name remains unambiguous in
Git history, links and deployment evidence.

| Sprint | Starts | Committed outcome |
| --- | --- | --- |
| [Sprint 01](sprint-01-2026-07-22/README.md) | 2026-07-22 | Complete NATS/Redis/DNA architecture migration, local runtime, production deploy and cutover |
| [Sprint 02](sprint-02-2026-08-05/README.md) | 2026-08-05 | Resilience, observability, capacity and horizontal-scale proof |
| [Sprint 04](sprint-04-2026-08-06/README.md) | 2026-08-06 | auth-service, the analytics read model and the internal admin app, in that priority order; the confirmed wake-mechanism defect is deliberately deferred |
| [Sprint 05](sprint-05-2026-08-13/README.md) | 2026-08-13 | Operational telemetry end to end: the gateway's rollups, `telemetry-service` in Rust behind a dual-sink switch, and the admin Telemetry screen |
| [Sprint 03](sprint-03-2026-08-19/README.md) | 2026-08-19 | City bounded-context and high-fidelity vertical slice on the new platform |

Sprint 04 is numbered after Sprint 03 because it was scoped later, but its
start date places it here: it runs alongside Sprint 02's resilience work and
ahead of Sprint 03, which is unaffected — City and the admin/auth/analytics
track touch disjoint services and databases. Sprint 05 sits between them for
the same reason: it touches the gateway's own instrumentation and a new
service with its own database, none of which City depends on.

Sprint status is evidence-based:

- **Planned:** scope and acceptance are approved, implementation absent.
- **In progress:** at least one sprint branch is active.
- **Implemented:** source and automated checks exist.
- **Verified:** named local/deployed/manual evidence also passes.

No sprint is marked complete because calendar time ended. Unfinished acceptance
remains visible and must be re-planned explicitly.
