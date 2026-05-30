# AI Provider Switching

Set `AI_PROVIDER` to `mock`, `gemini`, or `openai`. Business services depend on `ai.Provider`; provider-specific REST payloads stay inside `internal/ai/providers`.

Automated tests use `mock` and must not call real AI providers.
