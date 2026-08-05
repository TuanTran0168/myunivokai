# Service wake mechanism — cold-start handling for free-tier domain services

> **Document status:** Proposed; not scheduled
> **Last source review:** 2026-08-05
> **Priority:** Explicitly deferred by the owner on 2026-08-05, behind
> auth-service, analytics-service and `apps/myunivokai-admin`. Recorded now so
> the design is not lost, not because it is next.
> **Owner's framing:** *"giống như fix bẩn cho render free tier vậy"* — a patch
> for a hosting-tier constraint, not a product feature. Treat it as such: keep
> it removable in one step (see §Removal when leaving free tier).

## Why this document exists despite being deferred

This is a real, reproduced production defect, not a hypothetical. It is recorded
in full so that when it is picked up — or if it causes a visible incident before
then — nobody has to re-derive the mechanism from scratch.

## The defect, reproduced

Live test against production, 2026-08-05:

```
POST https://myunivokai-gateway.onrender.com/api/nature/worlds
→ 202 Accepted

GET  https://myunivokai-gateway.onrender.com/api/jobs/01KZ9CKNPBMES0RC78S2WQ8G8A
→ 503 Service Unavailable
```

The 202 proves the gateway and JetStream accepted and persisted the command.
The 503 — not 504 — proves the failure was not a slow response timing out; it
was immediate, because [rpc_transport.go:69-77](../../services/api-gateway/internal/handlers/rpc_transport.go#L69-L77)
only produces `504 SERVICE_TIMEOUT` on `context.DeadlineExceeded`. Anything else,
including a Core NATS `no-responders` reply that returns instantly, becomes
`503 SERVICE_UNAVAILABLE`. No subscriber was listening on
`queries.dna.job.get.v1` — dna-service was asleep.

## Root cause

Render free web instances wake only on inbound HTTP. A NATS message cannot wake
one. The domain services ([dna](../../services/dna-service/cmd/service/main.go),
universe, nature) receive no inbound HTTP in normal operation — they are pure
NATS consumers — so nothing in the current system ever wakes them once Render
puts them to sleep after idle.

Two request paths fail differently, and the difference matters for the fix:

| Path | Transport | Failure mode when the consumer is asleep |
| --- | --- | --- |
| Commands (create world) | JetStream `PullSubscribe`, workqueue retention | Message is durably held. **Not lost.** Nobody is pulling, so the job never advances past `queued` |
| Queries (list, get, publish, share, job status) | Core NATS `QueueSubscribe` | No responder exists. NATS replies `no-responders` **immediately** — not a timeout |

This split makes the write path more dangerous than the read path: a `POST`
returns `202` and looks successful, then silently stalls. The read path at
least surfaces as an error the caller can react to.

## Design: proactive wake on write, reactive wake on read

A wake mechanism that only reacts to `no-responders` is not sufficient by
itself. Trace what happens on `POST /api/nature/worlds` with reactive-only wake:

1. `POST` → `202` — a command publish never fails this way, so there is no
   error to react to.
2. dna-service is still asleep. Nobody wakes it.
3. `GET /api/jobs/{id}` → dna is queried, not nature → if dna happens to be
   awake (or was woken by an unrelated read elsewhere), this returns `200
   queued`/`processing` with no error at any point.
4. nature-service is never the target of any client-facing request during this
   flow. It is never woken. The job never leaves `processing`.

Every HTTP response in that trace can be `200`. There is no signal to hang
retry logic on. This is why the write path needs a **proactive** wake — fired
on `POST`, before any error exists — while the read path can stay **reactive**,
firing only when a request actually hits `no-responders`.

```
Write path (POST /api/{family}/worlds):
  gateway receives request
    → fire-and-forget GET to dna's  /healthz
    → fire-and-forget GET to {family}'s /healthz
    → publish command to JetStream as today
    → return 202 immediately (no added latency; the job flow is already async)

Read path (any NATS request/reply):
  gateway sends request, gets no-responders
    → SET myunivokai:wake:<service> NX EX 60   (Redis single-flight lock)
    → if lock acquired: fire-and-forget GET to that service's /healthz
    → respond 503 SERVICE_WAKING with Retry-After
    → subsequent requests within the 60s window see the lock held and skip the ping
```

## Status code contract

The current code collapses every non-timeout NATS error into one `503
SERVICE_UNAVAILABLE`. That must split, because the client needs to know whether
retrying is useful:

| Code | Condition | Meaning | Client action |
| --- | --- | --- | --- |
| `503 SERVICE_WAKING` | `errors.Is(err, nats.ErrNoResponders)`, wake ping fired | Service is asleep, has been pinged | Retry after `Retry-After` |
| `503 SERVICE_UNAVAILABLE` | Any other transport failure (NATS disconnected, marshal error, etc.) | Real infrastructure problem | Retry is unlikely to help |
| `504 SERVICE_TIMEOUT` | `context.DeadlineExceeded` | Service is awake but slow | Unchanged from today |

## Why the gateway must not wait for the wake to finish

Two independent reasons rule out "ping, wait, retry internally, then answer the
original request":

- **Server write timeout.** [main.go:51](../../services/api-gateway/cmd/gateway/main.go#L51)
  sets `WriteTimeout` to roughly `NATSPublishTimeout + NATSRequestTimeout +
  margin` — about 8 seconds. Docker cold start on Render free is commonly
  20–60 seconds. The HTTP response would be cut off before the domain service
  is even reachable.
- **The gateway is also a free instance.** Holding connections open for 30–60s
  while a domain service boots risks exhausting the gateway's own capacity —
  turning one sleeping service into a second incident.

The correct shape is: answer fast, tell the client when to come back, let the
client's own retry naturally land after the wake completes.

## `/healthz` is a start signal, not a readiness signal

The existing health handler in all three domain services
([dna example](../../services/dna-service/cmd/service/main.go#L31-L33)) returns
`200` as soon as the HTTP mux binds a port — deliberately, since this is the
mechanism Render free-tier deployment already relies on to avoid needing a
Background Worker plan. It returns `200` **before** the NATS messaging runtime
has finished `Run()`.

A `200` from the wake ping means only "the container has started, or was
already running." It does not mean the service can answer a query yet. This is
why the mechanism is fire-and-forget with a client-side retry delay, never
"ping until 200, then retry immediately."

A separate, later improvement — making `/healthz` report true readiness (NATS
connected, DB reachable), the way the gateway's own `Readiness` handler already
does — is out of scope here and must be done carefully: if a domain service
ever gets a `healthCheckPath` in `render.yaml` (none is set today), a health
endpoint that reports non-200 during startup risks Render killing the container
before it finishes booting.

## Idempotency and duplicate-ping safety

The Redis `SET NX EX 60` lock exists purely to avoid noise — N concurrent
requests hitting a sleeping service should produce one outbound ping, not N.
It is not a correctness requirement: an extra HTTP GET to a public `/healthz`
endpoint is harmless. The gateway already holds a Redis client and the
`myunivokai` key prefix convention (`REDIS_KEY_PREFIX`), so this is additive,
not new infrastructure.

## SSRF note

The wake targets (`DNA_SERVICE_URL`, `UNIVERSE_SERVICE_URL`,
`NATURE_SERVICE_URL`) are operator-supplied env vars, not request-derived —
there is no user input in the URL. Validate scheme/host at config load time
regardless, so a misconfigured env var fails fast at startup rather than
producing a silent no-op or an unexpected outbound call at request time.

## Frontend change

[api.ts:57-90](../../apps/myunivokai-web/src/lib/api.ts#L57-L90) already
retries idempotent GETs once on `429`, reading `Retry-After`. Extending the same
mechanism to `503 SERVICE_WAKING` — with a larger retry budget (roughly 5–8
attempts across 30–60s, to cover real Render cold-start duration) — is a
parameter change, not a new code path. The existing rule stays: mutating
requests are never retried automatically.

The frontend never learns about wake targets or service topology. It only
learns to treat one specific error code as retryable. This also removes the
need for anything like a dedicated `POST /api/admin/wake` endpoint in the
admin app — see the cross-reference below.

## Relationship to the analytics plan

[analytics-service-plan.md](analytics-service-plan.md) originally proposed a
dedicated `POST /api/admin/wake` route for the admin app to call on mount. That
is now removed from that plan: if the gateway's reactive wake is in place
globally, the admin app's first query against a sleeping analytics-service
naturally receives `503 SERVICE_WAKING` and retries like any other client. A
separate endpoint would have made the frontend into a wake-aware caller for no
benefit — precisely the layering this document argues against in §Frontend
change.

## Removal when leaving free tier

This is designed to be deleted, not maintained indefinitely, once domain
services stop sleeping (paid plan, or converted to genuine Background Workers
as [the original V1 deployment doc](versions/v1-2026-07-22/deployment.md)
specifies).

| Part | On leaving free tier |
| --- | --- |
| Proactive ping on `POST` | **Remove.** Becomes a useless outbound call on every world creation |
| Reactive ping on `no-responders` | **Remove** the ping call itself |
| `no-responders` vs `DeadlineExceeded` classification | **Keep permanently** — see below |
| `SERVICE_WAKING` / `SERVICE_UNAVAILABLE` / `SERVICE_TIMEOUT` split | **Keep permanently** |
| Frontend retry on `SERVICE_WAKING` | **Keep permanently**, though it will rarely fire |
| Redis single-flight lock | **Keep** — reusable for any future expensive side effect triggered by a request burst |

Gate the ping behavior behind a single flag, e.g. `SERVICE_WAKE_ENABLED`, so the
removal step is a config change, not a code change. Keep the classification and
retry contract regardless of the flag: `no-responders` is a legitimate,
recurring production condition even on paid plans — during a rolling deploy, a
crash-restart, an OOM-kill, or a scale-down — and today the gateway detects it
but discards the distinction. That part is not a free-tier workaround; it is
missing production telemetry.

## Tension with the documented V1 target

Recorded for honesty, not as a blocker: the approved V1 architecture states
three times, in
[solution-architecture.md:311-315](versions/v1-2026-07-22/solution-architecture.md#L311-L315),
[deployment.md:39-41](versions/v1-2026-07-22/deployment.md#L39-L41), and
[contracts-and-roadmap.md:64](versions/v1-2026-07-22/contracts-and-roadmap.md#L64),
**"do not add an HTTP wake-up hack"** — on the assumption that domain services
would run as paid Render Background Workers, which do not sleep.

`render.yaml` already deploys all three domain services as `type: web, plan:
free`, not Background Workers. That deviation from the documented target
predates this document and predates the wake mechanism proposed here — it is
why the defect in §The defect, reproduced exists at all. This document proposes
a mitigation for a deviation that has already happened, not a new one. If the
fleet ever moves to paid Background Workers as originally specified, this
entire document — proactive ping, reactive ping, and the Redis lock — becomes
unnecessary, though the status-code classification and frontend retry contract
remain good practice regardless (see §Removal when leaving free tier).

## What is not in scope here

- Making `/healthz` report real readiness — separate, later improvement.
- Any change to command-path (`PullSubscribe`) retry or dead-lettering — the
  workqueue already holds commands durably; this document only addresses
  getting a consumer awake to pull them.
- A cron or scheduled keep-alive — explicitly rejected by the owner earlier;
  see [auth-and-admin-plan.md](auth-and-admin-plan.md) for the same constraint
  applied to the admin app.
