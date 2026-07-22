# DNA Service

DNA Service owns raw profile input, root generation jobs, AI provider
orchestration, immutable canonical ProfileDNA, and family completion state. It
is the only backend module allowed to contain provider-specific code under
`internal/ai/providers`.

It consumes the durable DNA generation command, publishes the selected family
compose command through an outbox, consumes family result events, and answers
job queries over Core NATS. It exposes no HTTP server.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/migrate
go run ./cmd/service
```

Production uses `Dockerfile.prod` as Render Background Worker
`myunivokai-dna`. AI defaults to `mock`; managed keys are supplied only through
the deployment platform.
