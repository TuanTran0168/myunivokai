# Myunivokai

My universe, okay? Nhập vài thông tin về bản thân, AI phân tích thành "Personality DNA",
backend sinh cấu hình thế giới từ seed, frontend vẽ thành một hệ mặt trời 3D của riêng bạn
bằng three.js. Có thể tạo lại variant, lưu gallery, publish link chia sẻ công khai.

## Cách nó hoạt động

```txt
Form (Next.js)
  → POST /api/v1/worlds (Go)
  → AI provider (Gemini/OpenAI/mock) sinh Personality DNA dạng JSON có schema
  → backend validate DNA, sinh World Seed + World Scene Config (deterministic, không phụ thuộc AI)
  → lưu PostgreSQL (hoặc in-memory khi dev)
  → frontend đọc config, render hệ mặt trời bằng React Three Fiber
```

Hai quyết định kiến trúc đáng chú ý:

1. AI chỉ sinh phần ngữ nghĩa (archetype, tên cảnh, ý nghĩa các hành tinh). Mọi con số 3D
   do backend sinh từ seed trong biên an toàn, nên "tạo variant mới" không tốn một call AI nào,
   và cùng một seed luôn vẽ ra đúng một cảnh.
2. Provider AI nằm sau một interface duy nhất. Đổi Gemini sang OpenAI là đổi env
   `AI_PROVIDER`, không đổi code. `mock` dùng cho test và dev không cần API key.

## Cấu trúc repo

```txt
apps/web        Next.js 14 + TypeScript + Tailwind + React Three Fiber
apps/api        Go + chi + pgxpool, migrations bằng goose
contracts       JSON schemas + OpenAPI dùng chung hai phía
docs            Ghi chú kiến trúc ban đầu
notes           Tài liệu nội bộ cho người và AI agent (bắt đầu từ notes/README.md)
```

## Chạy backend

```bash
cd apps/api
go run ./cmd/api
```

Mặc định `AI_PROVIDER=mock`. Nếu `DATABASE_URL` rỗng thì API tự dùng in-memory store,
nên không cần dựng database để dev. Env mẫu ở `apps/api/.env.example`.

Config loader đọc `.env`, `.env.local`, và file theo môi trường (`.env.dev`, `.env.prod`...).
Ép file cụ thể bằng `APP_ENV=prod` hoặc `MYUNIVOKAI_ENV_FILE=.env.prod`.

Health check và Swagger:

```bash
curl http://localhost:8080/api/v1/healthz
# http://localhost:8080/swagger/index.html
```

Regenerate Swagger sau khi đổi handler/model:

```bash
swag init -g cmd/api/main.go -o docs --parseDependency --parseInternal
```

## Chạy frontend

```bash
cd apps/web
npm install
npm run dev
```

Mở http://localhost:3000. FE gọi API qua `NEXT_PUBLIC_API_BASE_URL`
(mặc định `http://localhost:8080/api/v1`, env mẫu ở `apps/web/.env.example`).

Tạo một world từ form rồi vào trang world để xem cảnh 3D. Lưu ý: landing page
hiển thị cảnh preview trừu tượng; hệ mặt trời đầy đủ chỉ render khi có world thật.

## Chạy bằng Docker Compose

```bash
cd apps/api
docker compose -f docker-compose-local.yml up --build
```

Stack này dựng PostgreSQL, chạy migrations rồi start API ở cổng 8080.
File `apps/api/.env.local` được mount vào container API và migration.

## Test và checks

```bash
# Backend
cd apps/api && go test ./... && go vet ./...

# Frontend
cd apps/web && npm run typecheck && npm run lint && npm run build
```

Test backend luôn chạy với mock provider, không gọi AI thật.

## Tài liệu

- `notes/README.md` — mục lục tài liệu nội bộ (quy ước git, coding style, kiến trúc FE/BE)
- `notes/fe/threejs-scene-architecture.md` — three.js được dùng thế nào, cách thêm loại cảnh mới
- `AGENTS.md` — quy tắc cho AI agent làm việc trong repo

Texture hành tinh lấy từ Solar System Scope (CC BY 4.0),
ghi nguồn tại `apps/web/public/textures/solar-system/ATTRIBUTION.md`.

## Triển khai

Web lên Vercel, API lên Railway/Fly/Render, database dùng Neon PostgreSQL
(pooled URL cho runtime, direct URL cho migrations). CORS production chỉ cho phép
domain web thật, không dùng wildcard.
