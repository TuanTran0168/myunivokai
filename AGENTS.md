# AGENTS.md - Myunivokai

## Mission

Build Myunivokai: an AI-powered personal 3D universe generator.

## Stack

- Web: Next.js, TypeScript, Tailwind, React Three Fiber
- API: Go, chi, pgxpool
- DB: PostgreSQL on Neon
- AI: provider abstraction supporting gemini, openai, mock

## Rules

- Do not call AI from frontend.
- Do not expose secrets.
- Keep provider-specific logic in `internal/ai/providers`.
- Business services depend only on the `ai.Provider` interface.
- Validate user input and AI output.
- Use mock provider in tests.
- Regenerate variants without AI by default.
- Public share APIs must not return raw sensitive input.

## Commands

```bash
cd apps/api
go test ./...
go vet ./...
```
