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

## Required reading for agents

Before writing code or committing, read the docs in `notes/`:

- `notes/README.md` — index of all internal docs
- `notes/coding/git-convention.md` — branch naming + commit message format (mandatory)
- `notes/coding/coding-style.md` — no hardcoded values, no abbreviated names (mandatory)
- `notes/fe/source-overview.md` — how the Next.js app is wired (read for FE tasks)
- `notes/fe/threejs-scene-architecture.md` — three.js principles, scene renderer registry, how to add new scene types (read before touching 3D code)
- `notes/be/source-overview.md` — Go API layers, AI provider switching, response shapes (read for BE tasks)

## Commands

```bash
# Backend
cd apps/api
go test ./...
go vet ./...

# Frontend
cd apps/web
npm run typecheck
npm run lint
npm run build
```
