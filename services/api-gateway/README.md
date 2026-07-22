# Myunivokai API Gateway

The gateway is the only public backend. It owns HTTP validation, request IDs,
CORS/security headers, Redis rate limiting/cache, JetStream publication, and
bounded Core NATS request-reply. It does not call AI or domain HTTP APIs.
DNA job, Universe, and Nature routes have separate handlers. Universe/Nature
subjects are fixed when each handler is constructed; shared RPC/cache mechanics
remain centralized in `RPCTransport`.

Generation flow:

1. `POST /api/{family}/worlds` validates the existing world-input contract.
2. The gateway publishes `myunivokai.commands.dna.generate.v1` and waits for
   JetStream `PubAck`.
3. It returns `202` with `jobId`, family, and `queued` status.
4. `GET /api/jobs/{jobId}` queries DNA Service through Core NATS.
5. World, variant, publish, and share routes query the owning family through
   versioned NATS subjects.

Redis is never a job queue or source of truth. Active jobs cache for one second;
terminal jobs, worlds, and privacy-safe share projections use configured bounded
TTLs. If Redis fails, cache becomes a miss and rate limiting falls back to a
conservative process-local bucket. Readiness reports the degradation.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/gateway
```

Local default: <http://localhost:8080>. See the root Compose file for the full
NATS/Redis/domain stack and `contracts/openapi.yaml` for public routes.
