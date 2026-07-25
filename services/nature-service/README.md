# Nature Service

Nature Service is the private NATS bounded context for deterministic Forest
worlds. It does not expose HTTP and does not call an AI provider.

It consumes `myunivokai.commands.nature.compose.v1`, snapshots canonical
ProfileDNA, builds the existing Forest SceneConfig, persists inbox/world/variant
and completion outbox atomically, and answers versioned Core NATS queries for
get/list/variant/select/publish/share.

`internal/handlers/NATSHandler` owns compose and world-lifecycle transport
handling; `internal/messaging` owns NATS connection, subscription, retry/ack,
and outbox lifecycle.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/migrate
go run ./cmd/service
```

Local integrated startup is owned by root `docker-compose-local.yaml`. Standalone
component startup expects `infra/docker-compose-local.yaml` to already be running.
Production uses the two-stage `Dockerfile.prod` and Render Background Worker
name `myunivokai-nature`—the runtime type is intentionally not appended to the
name.

The Forest renderer/asset contract is documented in
`notes/fe/forest-render-mechanism.md` and remains covered by deterministic and
golden tests.
