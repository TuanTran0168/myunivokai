# Universe Service

Universe Service is the private NATS bounded context for deterministic solar
system worlds. It consumes canonical ProfileDNA snapshots, owns
`myunivokai_universe`, and answers world lifecycle queries through Core NATS.
It exposes no HTTP server and contains no provider adapter.

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

Production uses `Dockerfile.prod` as Render Background Worker
`myunivokai-universe`. Local integrated startup is owned by the root Compose
aggregator; component Compose expects shared `infra` to be running.
