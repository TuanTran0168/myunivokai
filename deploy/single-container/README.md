# Single-container backend deploy — research + build

> **Status:** Built and smoke-tested locally (`docker build` succeeds, image
> is 443 MB; running it with dummy credentials confirms `supervisord.conf`
> parses correctly and all eight processes start, each failing only on its
> own genuinely-missing value — e.g. `auth` reports `AUTH_ACCESS_PRIVATE_KEY
> is required`, `dna` reports `DATABASE_URL is required` — exactly the
> per-service error a real deploy with an incomplete `.env` would see). That
> smoke test is also what found and fixed the bug described below in
> "Why `docker-entrypoint.sh` defaults every optional variable." **Not yet
> deployed to a real Koyeb account** — the platform specifics below are from
> documentation and community reports, and a full boot against real
> Neon/Upstash/Synadia credentials has not been run. Treat the resource-fit
> section as the first thing to verify there.

## The research: does either platform actually give what was assumed?

The premise going in was: Hugging Face Spaces or Koyeb, one container, no
sleep, no shared monthly instance-hour cap like Render's 750h/account. As of
August 2026, **neither claim holds cleanly** for this use case. Both
platforms are real and free, but not for what was assumed:

### Hugging Face Spaces — Docker SDK is no longer free

Spaces backed by the **Docker SDK** (what a custom multi-process container
needs — this repo is not a Gradio app) now require a **paid plan**: PRO for
a personal account, Team/Enterprise for an organization. This changed
recently — community reports place it around July 2026, and the forum
thread title says it plainly: *"Docker SDK now marked as Paid when creating
a new Space."* Free accounts can still host Gradio apps and a couple of
ZeroGPU Spaces, but not an arbitrary Dockerfile. **This rules HF Spaces out
as a free option for this repo entirely** — not a resource-fit problem, a
"you cannot create the Space" problem.

### Koyeb — free, but smaller and not sleep-free

Koyeb does let a free account deploy an arbitrary Docker image, one Free
Instance per organization. The actual shape of that free instance:

| | Koyeb Free Instance | Render Free (this repo's status quo) |
| --- | --- | --- |
| RAM | 512 MB | 512 MB |
| vCPU | 0.1 | 0.1 |
| Disk | 2 GB SSD, no Volumes | ephemeral |
| Sleeps on idle | **Yes — after 1 hour, cannot be disabled** | Yes — after 15 minutes |
| Monthly instance-hour cap shared across services | No such cap | **750h/month, shared across every free service in the account** |
| Regions | Frankfurt or Washington D.C. only | several |

So: Koyeb **does sleep** — the "no sleep" part of the premise is wrong, it
is a different idle timeout (1h vs 15m), not the absence of one. What Koyeb
actually removes is Render's specific pain: **the 750-hour pool split across
every free service in the account**, which is exactly what
`notes/ops/production-deployment-guide.md` and `render.yaml`'s own comments
have been tracking ("seventh free web service — check the instance-hour
budget first"). With eight backend services each getting their own Render
container, that pool gets divided eight ways. Packing all eight into **one**
container/one Koyeb instance means there is only one thing to divide the
budget by — the actual win here is architectural (fewer containers,
therefore less pool pressure and one wake instead of a wake-the-whole-chain
cascade), not "no more sleeping."

**The real open question is resource fit, not policy.** 512 MB / 0.1 vCPU
for eight processes at once (api-gateway, dna, universe, nature, ocean,
auth, analytics, telemetry) has not been measured against this image yet.
Go binaries idle small (single-digit to low-double-digit MB RSS each); the
Rust binary should be similar. Eight of them plus NATS/Postgres/Redis
client connection overhead *might* fit in 512 MB, but 0.1 vCPU means a cold
boot — eight processes each opening a NATS connection, six of them running
a Postgres migration — will be slow, and slow enough to trip a platform
health-check timeout is a real risk that only an actual deploy will answer.
If it doesn't fit: the honest next step is trimming which services run
here (e.g. defer `ocean`/`nature` and keep them on Render a while longer)
or a paid Koyeb Nano/Micro instance (still far cheaper than Render's paid
tier), not fighting the free tier harder.

### Frontends are explicitly out of scope here

`myunivokai-web` already runs on Vercel — `render.yaml`'s own top comment
says so — which has no per-service instance-hour budget to escape in the
first place. `myunivokai-admin` is a second Next.js app with its own
hardcoded cookie paths (`middleware.ts`, `auth-relay.ts`, `login/page.tsx`
all set `Path=/api/admin/auth` or `Path=/`); reverse-proxying it under a
shared path prefix on one port would need those paths rewritten to match,
which is an app-code change this scaffold does not make. Keeping both
frontends where they already work avoids that rabbit hole. **This deploy
covers the eight backend services only** — the actual source of Render's
750h pressure.

## What's in this folder

| File | What it does |
| --- | --- |
| `Dockerfile` | Multi-stage build: one builder stage per service (the exact `go build`/`cargo build` command each service's own `Dockerfile.prod` already runs), all copied into one Debian runtime stage |
| `supervisord.conf` | Runs and restarts all eight processes; maps each service's per-database env vars onto the generic `DATABASE_URL`/`PORT` names each binary actually reads |
| `docker-entrypoint.sh` | Writes `NATS_CREDS_CONTENT` to `/app/secrets/nats.creds` before supervisord starts — see why below |
| `.env.example` | Every environment variable to set on the platform, one section per service |

## Why an entrypoint script writes the NATS credentials file

Render's blueprint uses a dashboard "Secret File" feature to mount
`nats.creds`. Whether Koyeb has an equivalent has not been verified here, so
this deploy uses the one mechanism guaranteed to exist everywhere: an
environment variable. `NATS_CREDS_CONTENT` holds the full multi-line
contents of the `.creds` file Synadia issues, and `docker-entrypoint.sh`
writes it to disk before any backend process starts. If Koyeb (or whatever
platform is used) turns out to support real secret files, switching to one
is a small follow-up, not a redesign.

## Why `docker-entrypoint.sh` defaults every optional variable

Found by actually running the built image, not by reading supervisor's
docs: `supervisord`'s `%(ENV_X)s` expansion is all-or-nothing at the
*config-parse* stage, not per-program. Leaving a handful of optional
variables unset entirely (as opposed to set to an empty string) — the first
smoke test skipped `ADMIN_ALLOWED_ORIGIN`, `GEMINI_API_KEY`, and a few
others — made supervisord refuse to start **any** of the eight programs,
with one error naming a variable and a section, not eight independent
failures. A platform dashboard that lets an operator skip an optional field
must not be able to take down the entire backend fleet over it, so
`docker-entrypoint.sh` now exports every name `supervisord.conf` references
with `${VAR:-}` (or a real default, e.g. `AI_PROVIDER` falling back to
`mock`) before handing off to supervisord. This does not make the deploy
work with a required value missing — it changes *how* it fails, from one
opaque config-parse error to eight independent, service-specific ones
(confirmed above: `auth` names its own missing key, `dna` names its own
missing database, and so on) — which is the failure mode this README's
`.env.example` table is written to help diagnose.

## Why every non-gateway process gets an explicit `PORT`

Every `cmd/service/main.go` in this repo binds a bare `/healthz` server on
`$PORT`, defaulting to `:8080` when unset — harmless on Render, where each
service is its own container, fatal here, where all eight share one network
namespace and a second bind to `:8080` crashes on boot.
`supervisord.conf` gives dna/universe/nature/ocean/auth/analytics one fixed
port each (8082-8087) and telemetry 8081; only `api-gateway` binds the
platform's actual public port. None of the other seven ports are reachable
from outside the container — nothing needs them to be, since
`SERVICE_WAKE_PLATFORM=none` here (there is no sleeping sibling to wake;
everything is already running in the same container the whole time it's up).

## Building and deploying

```bash
# From the repository root — every service's go.mod depends on contracts/go
# (and telemetry-service on contracts/rust) at this fixed relative path,
# exactly like render.yaml's own dockerContext: . for every service.
docker build -f deploy/single-container/Dockerfile -t myunivokai-services-koyeb .

# Local smoke test before pushing to a registry — fill in a real .env first,
# copied from .env.example. NATS_CREDS_CONTENT is passed separately with -e
# rather than through --env-file: Docker's --env-file format is line-based
# and cannot hold a real multi-line value, but a shell variable can, and
# docker run -e forwards it whole. Put the raw .creds file contents in
# deploy/single-container/.env.nats-creds (gitignored, matches .env.* in
# .gitignore) and this command reads it at invocation time:
docker run --rm -p 8080:8080 \
  --env-file deploy/single-container/.env \
  -e NATS_CREDS_CONTENT="$(cat deploy/single-container/.env.nats-creds)" \
  myunivokai-services-koyeb
```

On Koyeb: create a Service from this Dockerfile (or from a registry image
built by CI), set the port to 8080, and fill in every variable from
`.env.example` under the service's Environment tab. First boot runs six
Postgres migrations and eight NATS connections back-to-back on 0.1 vCPU —
give the health check a generous grace period before assuming it's stuck.

## What's unverified and should be checked on a real account before relying on this

- Whether eight processes actually fit in 512 MB RAM under real load, not
  just at idle.
- Whether a cold boot completes before Koyeb's own health-check deadline.
- Whether Koyeb has a secret-file mechanism that would let
  `docker-entrypoint.sh` be replaced with a direct mount.
- Whether Koyeb's Frankfurt/Washington-D.C.-only regions add meaningful
  latency versus Render's current region for this app's actual users.
