# Auth Service

Auth Service is the private NATS bounded context for staff identity. It owns
`myunivokai_auth` and answers login/refresh/logout/tokenversion/account
queries through Core NATS. It exposes no HTTP business API — the same rule
every other domain service follows — and it never reads a world, a variant
or a job. See [notes/vision/auth-and-admin-plan.md](../../notes/vision/auth-and-admin-plan.md).

`internal/services/AuthService` owns the login/refresh/logout/lockout rules;
`internal/security` owns Argon2id password hashing and Ed25519 access-token
minting/verification; `internal/redis` writes the `tokenVersion` cache the
gateway's revocation check reads; `internal/handlers/NATSHandler` owns
transport; `internal/messaging` owns the NATS connection and subscriptions —
Core NATS request-reply only, no JetStream command or outbox, since
auth-service publishes no domain event.

## First run

Generate an Ed25519 seed for `AUTH_ACCESS_PRIVATE_KEY` (32 raw bytes,
base64-encoded) and put it in the root `.env.local` — never commit a real
value:

```powershell
# any of these work; all print a base64 32-byte value
openssl rand -base64 32
```

Then create the first account (no self-signup exists anywhere in this
service):

```powershell
go run ./cmd/bootstrap --email you@example.com --password "a-strong-password-12-chars-or-more"
```

or set `AUTH_BOOTSTRAP_EMAIL` / `AUTH_BOOTSTRAP_PASSWORD` instead of flags.
The created account is a super admin and must change its password on first
login.

```powershell
go test ./...
go vet ./...
go build ./...
go run ./cmd/migrate
go run ./cmd/service
```

Production uses `Dockerfile.prod` as a Render web service, `myunivokai-auth`
— a free-tier `PORT`-bound health server for the same cold-start reason every
other domain service has one; see
[notes/vision/service-wake-mechanism.md](../../notes/vision/service-wake-mechanism.md).
Local integrated startup is owned by the root Compose aggregator; component
Compose expects shared `infra` to be running.
