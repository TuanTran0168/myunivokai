# Analytics Service

Analytics Service is the admin read model. It consumes events, writes its own
database, and answers admin queries. **It never publishes an event, never
accepts a write from the edge, and never calls another service.**

That last sentence is the whole design, and it is checkable in review:

> The only writer to `myunivokai_analytics` is this service's own event
> consumer. Every other path into this service is read-only.

Two structural consequences you will notice reading the code:

- There is **no `outbox_messages` table** and no outbox publish loop. Every
  other service in this repo has both. A reviewer who finds one here should
  treat it as a design violation, not an omission.
- Its NATS user may publish **no `myunivokai.*` subject at all** — only
  `$JS.API.>` (its own durable consumer) and `_INBOX.>` (a reply to whoever
  asked). The ACL in [infra/nats/nats-server.conf](../../infra/nats/nats-server.conf)
  enforces the rule rather than trusting the code to honour it.

See [notes/vision/analytics-service-plan.md](../../notes/vision/analytics-service-plan.md)
for why this exists instead of the gateway fanning out to universe, nature and
dna: three processes serve an admin page (gateway, auth, analytics), and no
sleeping domain service is ever on that path.

## What it consumes

One durable consumer, `analytics-events-v1`, filtered on the wildcard
`myunivokai.events.>` — a new event subject reaches it without a code change.

| Event | Effect |
| --- | --- |
| `dna.generated` | job → `processing` |
| `dna.failed` | job → `failed`, with the error code |
| `{family}.completed` | job → `completed`, **and** the world's first snapshot |
| `{family}.failed` | job → `failed`, with the error code |
| `{family}.world.changed` | world upsert only |

Every delivery writes an `inbox_messages` row and its projection in one
transaction. JetStream guarantees duplicate delivery; `ON CONFLICT (message_id)
DO NOTHING` makes that a non-event.

Worlds move forward only: the upsert carries
`WHERE world_projections.revision < EXCLUDED.revision`, so a redelivered or
reordered older snapshot cannot overwrite a newer one. That guard is the
reason the design chose snapshot events over fine-grained ones — the
projection needs no ordering of its own.

`created_at` on a job uses `LEAST(existing, incoming)` for the same reason,
so a late-arriving first event still yields the right `duration_ms`. All
timestamps come from envelope fields stamped by the publishing service, never
from a clock inside this service — a job spans three processes and only the
envelope is common to all of them.

## What it answers

Four subjects, queue group `analytics-service-v1`:

| Subject | Answers |
| --- | --- |
| `queries.analytics.overview.get.v1` | Totals per family, failure rate, publish rate, duration percentiles, archetype/style/mood distributions |
| `queries.analytics.world.list.v1` | Paginated, filterable worlds table |
| `queries.analytics.job.list.v1` | Paginated jobs and failures with error codes |
| `queries.analytics.timeseries.get.v1` | Counts per day per family over a range |

Every aggregate is computed in SQL here. The gateway sums nothing and the
admin app sums nothing.

Pagination is **keyset**, never `OFFSET`: the cursor encodes the
`(timestamp, id)` the last page ended on, so page 1000 costs the same as page
1 and the response stays inside the gateway's 2500ms request/reply deadline
as the table grows. `pageSize` is clamped to 1–100 (default 25) and `days` to
1–90 (default 30) in `contracts.NormalizePageSize` / `NormalizeDays`, so the
gateway, this service and the admin app cannot disagree about what a page is.

## Data boundary

`myunivokai_analytics` is a second copy of production data, so what crosses
into it is an **allow list**, not a deny list, and
`contracts.WorldSnapshot` *is* that list. Nothing may be added to it without
a matching line in the plan's §Data boundary.

`nickname` is the only user-entered value here, kept deliberately so an admin
table has a human label. These never cross, under any phase: the submitted
form (`profiles.raw_input`), the generated profile (`dna_versions.profile_dna`,
`worlds.dna_snapshot`), the world quote, variant scene configs, AI request and
response bodies, and share slugs.

## Local development

The service is part of the root stack; nothing extra to run:

```bash
make local-up
```

Compose creates `myunivokai_analytics` with the role
`myunivokai_analytics_app`, runs `cmd/migrate`, then starts the consumer. All
values have `${VAR:-default}` fallbacks, so no `.env.local` edit is required.

Standalone, from this directory:

```bash
cp .env.example .env.local
go run ./cmd/migrate
go run ./cmd/service
```

Checks, exactly what CI runs:

```bash
go vet ./... && go test ./... && go build ./...
```

## Deployment runbook

`render.yaml` already declares `myunivokai-analytics`. **Do all four steps
before merging to `main`**, or the service crash-loops on first boot.

1. **Verify the Render budget.** This is the **sixth** free web service on the
   account (gateway, dna, universe, nature, auth, analytics). Free instance
   hours are shared account-wide — check the remaining budget first.

2. **Create the Neon database.** A separate database from auth's. If Neon's
   project limit binds, put analytics and auth in the same *project* as
   separate databases rather than sharing one database. Then set both, e.g.:

   ```
   DATABASE_URL=postgresql://myunivokai_analytics_app:REPLACE_WITH_NEON_PASSWORD@ep-cool-fog-12345678-pooler.ap-southeast-1.aws.neon.tech/myunivokai_analytics?sslmode=require
   DATABASE_DIRECT_URL=postgresql://myunivokai_analytics_app:REPLACE_WITH_NEON_PASSWORD@ep-cool-fog-12345678.ap-southeast-1.aws.neon.tech/myunivokai_analytics?sslmode=require
   ```

   `DATABASE_DIRECT_URL` is the **unpooled** host (no `-pooler`), used only by
   the migration runner — goose takes advisory locks, which a transaction
   pooler does not carry across statements.

3. **Point it at NATS.** Nothing to configure on the broker: production uses
   Synadia Cloud with **one account user shared by every service**, supplied
   as a `nats.creds` secret file, so this service reuses the existing
   Environment Group unchanged — see
   [notes/ops/production-deployment-guide.md](../../notes/ops/production-deployment-guide.md).
   Set `NATS_URL=tls://connect.ngs.global:4222` and
   `NATS_CREDENTIALS=/etc/secrets/nats.creds`, and **do not** set
   `NATS_USERNAME` / `NATS_PASSWORD`.

   The per-user block in
   [infra/nats/nats-server.conf](../../infra/nats/nats-server.conf) is
   therefore **local-only**. That matters for how you read this service's
   read-model guarantee: locally the ACL enforces "publishes no domain
   subject", in production only the code does. If per-user permissions are
   ever configured in Synadia, this is the block to copy, and `$JS.ACK.>` is
   the line most easily missed — acknowledging a JetStream delivery publishes
   under that prefix, not under `$JS.API.>`, and omitting it makes every
   message redeliver until `AckWait` expires, forever, logging only a
   `permissions violation` line and never failing at startup.

   ```
   {
     user: myunivokai_analytics
     password: REPLACE_WITH_A_GENERATED_PASSWORD
     permissions: {
       publish: ["$JS.API.>", "$JS.ACK.>", "_INBOX.>"]
       subscribe: ["_INBOX.>", "myunivokai.events.>", "myunivokai.queries.analytics.>"]
     }
   }
   ```

   Then set `NATS_URL`, `NATS_USERNAME=myunivokai_analytics` and
   `NATS_PASSWORD` on the Render service.

4. **Turn the admin routes on.** The gateway ships with
   `ADMIN_ROUTES_ENABLED=false`; the analytics screens stay unreachable until
   it is flipped to `true` **and** `ADMIN_ALLOWED_ORIGIN` holds the admin
   app's exact origin. Flipping it with an empty origin fails config
   validation and the whole gateway — product routes included — refuses to
   start.

### First start replays whatever the stream still holds

`MYUNIVOKAI_EVENTS` retains 7 days with `discard: old`. A brand-new durable
consumer defaults to `DeliverAll`, so the first start backfills the window for
free. There is no other backfill: an outage longer than 7 days is a permanent
gap, accepted deliberately at current data volume. Diagnose a hole in the read
model as retention first, not corruption.

## The cost to keep paying

Every future mutation in universe-service or nature-service must also bump
`worlds.revision` and write a `world.changed` outbox row inside the same
transaction, or this read model silently drifts — the world keeps changing in
the family database and stops changing in the admin app, with nothing failing
anywhere. That is the standard price of CQRS.

The guard is already in place:
`internal/repositories/world_snapshot_test.go` in **both** family services
asserts that every mutating store method leaves an outbox event behind. When
you add a mutation, add it to that table.
