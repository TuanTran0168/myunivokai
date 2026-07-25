# Render deployment entry point

> **Document status:** Active
> **Last source review:** 2026-07-22

The legacy public HTTP peer fleet is no longer represented by source or
`render.yaml`. Current deployment uses:

| Render name | Type | Public |
| --- | --- | :---: |
| `myunivokai-web` | Web Service | yes |
| `myunivokai-gateway` | Web Service | yes |
| `myunivokai-dna` | Background Worker | no |
| `myunivokai-universe` | Background Worker | no |
| `myunivokai-nature` | Background Worker | no |

The three workers require a paid Render instance; Free is not available for
Background Workers. They communicate through operator-provisioned managed NATS
and use three independent Neon databases. Gateway also requires managed Redis.

Use the complete dated runbook:

- [Sprint 1 deployment guide](../sprints/sprint-01-2026-07-22/deployment-guide.md)
- [Vision V1 deployment rationale](../vision/versions/v1-2026-07-22/deployment.md)

Do not deploy old `Dockerfile`, `Dockerfile.render`, `cmd/api`, upstream URLs,
or `GATEWAY_SHARED_SECRET`; those runtime paths were removed. Production uses
only `Dockerfile.prod` and the variables listed by the dated guide.

The repository prepares and validates configuration but does not contain
managed credentials and cannot prove a live deploy without an operator running
the runbook and recording the resulting service IDs, commit SHA, UTC time, and
smoke evidence.
