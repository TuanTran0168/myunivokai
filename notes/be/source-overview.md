# BE Source Overview — services/universe-service

Go + chi router + pgxpool. Một binary `cmd/api`, một tool migrate `cmd/migrate`.

## Luồng request tạo world

```txt
POST /api/v1/worlds
  → handlers/world_handler.go   decode + validate request (validation/world.go)
  → services/world_service.go   điều phối toàn bộ
      → ai/orchestrator.go      gọi provider chính, validate JSON, fallback nếu hỏng
      → seed/seed.go             sinh seed WLD-XXXXXXXXXX (crypto random)
      → services/world_config_builder.go
                                 DNA + seed → WorldSceneConfig (PRNG tất định, seed/prng.go)
  → repositories (store)         lưu world + variant + log AI
  → trả { world, variant, personalityDNA }
```

Nguyên tắc cốt lõi: **AI chỉ sinh Personality DNA** (ngữ nghĩa), còn mọi con số
3D (orbit, size, speed) do `world_config_builder` sinh từ seed trong biên an toàn.
Regenerate variant vì vậy KHÔNG gọi AI — chỉ seed mới + build lại config.

## AI provider switching

- `ai/provider.go` — interface `Provider.GenerateStructured()`. Business code chỉ biết interface này.
- `ai/providers/` — adapter Gemini + OpenAI (REST thuần trong `rest.go`), `mock.go` cho test/dev.
- `aifactory/factory.go` — đọc `AI_PROVIDER` (gemini | openai | mock) tạo provider.
- `ai/orchestrator.go` — retry/repair prompt, fallback sang `AI_FALLBACK_PROVIDER` khi lỗi kỹ thuật.
- Đổi provider = đổi env, không đổi code. Cấm import shape request của provider ra ngoài folder `providers/`.

## Store

`repositories/store.go` là interface; có 2 hiện thực:

- `postgres_store.go` — chạy thật với Neon/Postgres (`DATABASE_URL`).
- `memory_store.go` — tự bật khi `DATABASE_URL` rỗng. Dev FE không cần database.

## Response shapes (FE phụ thuộc trực tiếp)

Định nghĩa tại `models/responses.go`:

```txt
POST /worlds            → { world, variant, personalityDNA }
GET  /worlds/{id}       → { world, selectedVariant, variants, personalityDNA }   ← variants ở ROOT
GET  /share/worlds/{s}  → { world, variant, publicDNA }                          ← world không có id/input
```

Đổi shape ở đây thì phải sửa `clients/web-client/src/lib/api.ts` (normalize) cùng PR.

## Quy tắc bảo mật

- Share API không bao giờ trả `input` thô (goal/challenge của user) — xem `PublicWorld`.
- Không log/lưu API key. AI request/response log vào bảng `ai_generations`.

## Chạy local & checks

```bash
cd services/universe-service
go run ./cmd/api        # DATABASE_URL rỗng → memory store, AI_PROVIDER=mock mặc định
go test ./...
go vet ./...
```

Swagger: http://localhost:8080/swagger/index.html — regenerate bằng
`swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal`.
