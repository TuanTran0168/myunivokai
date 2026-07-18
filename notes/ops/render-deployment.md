# Hướng dẫn deploy lên Render — kiến trúc gateway + 2 peer service

> **Runbook thao tác** (cái "làm thế nào"). Phần lý do/thiết kế (vì sao có
> gateway, vì sao upstream vẫn public, hành vi free-tier) nằm ở
> [../vision/deployment.md](../vision/deployment.md). Nguồn sự thật của cấu hình
> là `render.yaml` ở gốc repo — tài liệu này bám theo nó.

## Bức tranh triển khai

```txt
Vercel (web client)
  └─ NEXT_PUBLIC_API_BASE_URL         → https://<gateway>/api/universe
     NEXT_PUBLIC_NATURE_API_BASE_URL  → https://<gateway>/api/nature
        │
        ▼
Render: myunivokai-gateway            (services/api-gateway, Docker)
   ├─ /api/universe/*  → myunivokai-api     (services/universe-service) → Neon DB "universe"
   └─ /api/nature/*    → myunivokai-nature  (services/nature-service)   → Neon DB "myunivokai_nature"
```

- 3 web service Docker trên Render, khai báo trong `render.yaml` (Blueprint).
- 2 **logical database trong CÙNG một project Neon** (không phải 2 project) — DB
  thứ hai không tốn phí. **Không bao giờ** trỏ DB nature vào DB universe.
- `GATEWAY_SHARED_SECRET` do Render tự sinh 1 lần trong env group
  `myunivokai-gateway-secrets`, link cho cả 3 service. Upstream free-tier vẫn có
  URL public nên mọi business route yêu cầu credential này; chỉ `/` và
  `/api/v1/healthz` để public cho probe của Render.

## Bước 0 — Chuẩn bị

- [ ] Có tài khoản Render (kết nối GitHub repo), Neon, Vercel.
- [ ] Đã đọc [../vision/deployment.md](../vision/deployment.md) để hiểu ràng buộc.
- [ ] `render.yaml` đã ở nhánh sẽ deploy (mặc định `main`).
- [ ] Sẵn origin FE để whitelist CORS (vd `https://myunivokai.vercel.app`).

## Bước 1 — Neon: 2 logical database, 4 connection string

Trong **một project Neon duy nhất**:

1. Databases → tạo database universe (nếu chưa có, vd `myunivokai`) và
   `myunivokai_nature`.
2. Với **mỗi** database lấy **2 URL**, đều `sslmode=require`:
   - **Pooled** (qua PgBouncer, host có `-pooler`) → dùng lúc chạy (`DATABASE_URL`).
   - **Direct** (không pooler) → dùng chạy migration (`DATABASE_DIRECT_URL`).

Kết quả: 4 URL.

| Biến | Universe | Nature |
| --- | --- | --- |
| `DATABASE_URL` (pooled, runtime) | dbname universe | dbname `myunivokai_nature` |
| `DATABASE_DIRECT_URL` (direct, migration) | dbname universe | dbname `myunivokai_nature` |

> Migration chạy trên URL **direct**; runtime dùng **pooled**. Init migration của
> nature sẽ **fail ngay** nếu vô tình trỏ vào DB universe (bảng đã tồn tại) — đó
> là hàng rào cố ý, không phải bug.

## Bước 2 — Render: sync Blueprint lần đầu

1. Render Dashboard → **New → Blueprint** → chọn repo → nhánh có `render.yaml`.
2. Render đọc `render.yaml`, hiện 3 service (`myunivokai-gateway`,
   `myunivokai-api`, `myunivokai-nature`) + env group
   `myunivokai-gateway-secrets` (tự sinh `GATEWAY_SHARED_SECRET`).
3. **Apply** để tạo. Deploy đầu sẽ *chưa xanh* cho tới khi điền hết biến
   `sync: false` ở Bước 3 — bình thường.

## Bước 3 — Điền các biến `sync: false` trong Dashboard

`render.yaml` chỉ khai báo *tên* các biến bí mật; **giá trị phải nhập tay trong
Dashboard** (không commit). Điền cho từng service:

### `myunivokai-gateway`

| Biến | Giá trị |
| --- | --- |
| `API_ALLOWED_ORIGINS` | origin FE, không wildcard, vd `https://myunivokai.vercel.app` |
| `UNIVERSE_SERVICE_URL` | URL public HTTPS của `myunivokai-api` (không kèm `/api/...`) |
| `NATURE_SERVICE_URL` | URL public HTTPS của `myunivokai-nature` |

(`APP_ENV=production`, `TRUST_PROXY=true`, `GATEWAY_SHARED_SECRET` từ group — đã
có sẵn từ `render.yaml`.)

### `myunivokai-api` (universe)

| Biến | Giá trị |
| --- | --- |
| `DATABASE_URL` | universe pooled |
| `DATABASE_DIRECT_URL` | universe direct |
| `PUBLIC_WEB_URL` | `https://myunivokai.vercel.app` (universe không có prefix) |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | để trống nếu chạy mock; nhập khi bật AI thật |

### `myunivokai-nature`

| Biến | Giá trị |
| --- | --- |
| `DATABASE_URL` | nature pooled (dbname `myunivokai_nature`) |
| `DATABASE_DIRECT_URL` | nature direct (dbname `myunivokai_nature`) |
| `PUBLIC_WEB_URL` | `https://myunivokai.vercel.app/nature` — **PHẢI kèm `/nature`** |

> **Vì sao nature cần `/nature`:** web client phục vụ trang share của nature ở
> `/nature/share/worlds/{slug}` (universe giữ route không prefix). `PUBLIC_WEB_URL`
> quyết định `shareUrl` mà service in ra, nên prefix làm link share rơi đúng
> trang — zero thay đổi code.

Cả 2 service có sẵn `AI_PROVIDER=mock`, `AI_FALLBACK_PROVIDER=mock`,
`RUN_MIGRATIONS_ON_START=true` từ `render.yaml` → entrypoint tự chạy migration
trên URL direct trước khi mở API.

**Ràng buộc production** (không thoả thì service từ chối khởi động):
- Gateway: 2 upstream URL phải là HTTPS tuyệt đối; `TRUST_PROXY=true`; CORS ≥1
  origin và không wildcard; `GATEWAY_SHARED_SECRET` ≥ 32 ký tự.
- 2 world service: `GATEWAY_SHARED_SECRET` ≥ 32 ký tự; từ chối fallback in-memory
  (bắt buộc có DATABASE_URL).

## Bước 4 — Rollout theo thứ tự + smoke test

1. Xác nhận 4 URL DB trỏ đúng logical database của nó.
2. Deploy/redeploy cả 3 service (Render tự deploy sau khi điền biến).
3. **Chờ upstream sống trực tiếp:** `GET https://<universe>/api/v1/healthz` và
   `GET https://<nature>/api/v1/healthz` trả **200**.
4. **Xác nhận business route bị chặn nếu không có key:** gọi thẳng
   `GET https://<universe>/api/v1/readyz` và `.../api/v1/worlds` → phải **401**
   khi thiếu `X-Gateway-Key` (nature tương tự).
5. **Gateway sống:** `GET https://<gateway>/api/v1/healthz` → 200;
   `GET https://<gateway>/api/v1/statusz` → 200 và báo cả 2 upstream ready (503
   nếu 1 cái chưa sẵn — thường do cold start, thử lại).
6. **Smoke qua gateway** cả 2 họ:
   ```bash
   curl -X POST https://<gateway>/api/universe/worlds -H "Content-Type: application/json" -d '{...}'
   curl -X POST https://<gateway>/api/nature/worlds   -H "Content-Type: application/json" -d '{...}'
   ```
   (payload mẫu xem `services/nature-service/README.md`.) Kiểm tiếp get /
   regenerate variant / publish / share.

## Bước 5 — Vercel: trỏ FE vào gateway

Vercel → Project → Settings → Environment Variables (giá trị inline lúc build,
nên **phải redeploy KHÔNG dùng build cache** sau khi đổi):

| Biến | Giá trị |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://<gateway>/api/universe` |
| `NEXT_PUBLIC_NATURE_API_BASE_URL` | `https://<gateway>/api/nature` |

> Hai biến này mang sẵn prefix đầy đủ, nên FE chuyển từ gọi thẳng service sang
> gọi qua gateway mà **không đổi code**. `NEXT_PUBLIC_NATURE_API_BASE_URL` là thứ
> bật họ scene rừng trên FE (picker Universe/Forest).
>
> **Vì sao 2 biến mà không phải 1?** Gateway chỉ cần 1 origin (tự forward theo
> path prefix); 2 biến ở đây thực chất là **cùng 1 gateway host**, chỉ khác
> suffix — di sản từ thời universe/nature còn là 2 host thật khác nhau. Xem đề
> xuất gộp còn 1 biến ở
> [frontend-gateway-consolidation.md](../vision/frontend-gateway-consolidation.md)
> (chưa triển khai).

## Cập nhật một Blueprint đã tồn tại (gotcha quan trọng)

Khi sync lại `render.yaml` lên Blueprint **đã có sẵn**, Render **KHÔNG tự điền**
các biến `sync: false` mới thêm. Vì vậy khi thêm service/biến mới (vd lần thêm
gateway + nature):

1. Vào Dashboard **thêm trước** các biến `sync: false` mới (đặc biệt 3 biến
   gateway: `API_ALLOWED_ORIGINS`, `UNIVERSE_SERVICE_URL`, `NATURE_SERVICE_URL`).
2. Rồi mới sync Blueprint.
3. Kiểm env group tự sinh vẫn link đủ cả 3 service (đừng tạo 3 secret rời rạc —
   phải là **một** giá trị chia sẻ).

## Bảng biến môi trường tổng hợp

| Biến | gateway | universe | nature | Nguồn |
| --- | :---: | :---: | :---: | --- |
| `APP_ENV=production` | ✓ | ✓ | ✓ | render.yaml |
| `TRUST_PROXY=true` | ✓ | | | render.yaml |
| `RUN_MIGRATIONS_ON_START=true` | | ✓ | ✓ | render.yaml |
| `AI_PROVIDER` / `AI_FALLBACK_PROVIDER` | | `mock` | `mock` | render.yaml |
| `GATEWAY_SHARED_SECRET` | ✓ | ✓ | ✓ | env group (tự sinh) |
| `API_ALLOWED_ORIGINS` | ✓ | | | Dashboard |
| `UNIVERSE_SERVICE_URL` / `NATURE_SERVICE_URL` | ✓ | | | Dashboard |
| `DATABASE_URL` / `DATABASE_DIRECT_URL` | | ✓ | ✓ | Dashboard (Neon) |
| `PUBLIC_WEB_URL` | | ✓ | ✓ `/nature` | Dashboard |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | | ✓ | (N4) | Dashboard (khi bật AI) |
| `NEXT_PUBLIC_API_BASE_URL` | | | | Vercel |
| `NEXT_PUBLIC_NATURE_API_BASE_URL` | | | | Vercel |

## Bật AI thật (đổi khỏi mock)

Mặc định cả 2 service chạy `mock` (universe prod cũng mock hôm nay). Để bật thật:

1. Nhập `GEMINI_API_KEY` hoặc `OPENAI_API_KEY` (Dashboard, `sync: false`).
2. Đổi `AI_PROVIDER=gemini|openai` (giữ `AI_FALLBACK_PROVIDER=mock` để an toàn).
3. Redeploy. **Universe** hỗ trợ gemini/openai/mock; **nature** hiện chỉ wire mock
   (cổng gemini/openai là việc round N4 — xem
   [../vision/nature-service-plan.md](../vision/nature-service-plan.md)).

> **Không bao giờ commit API key/secret.** Chúng chỉ sống trong Dashboard
> (`sync: false`). `render.yaml` chỉ khai báo tên biến.

## Rollback, free-tier, quan sát

- **Rollback nature** = tắt/không deploy service nature; universe không bị ảnh
  hưởng (2 service độc lập, không đọc chéo DB).
- **Free-tier:** mỗi service ngủ độc lập; request lạnh có thể mất ~1 phút để đánh
  thức gateway rồi upstream. Timeout create 120s khớp ngân sách sinh AI; read/share
  timeout thấp hơn. Circuit breaker chặn upstream chết ngốn slot, nhưng không
  giấu được cold start.
- **Health/log:** gateway `/api/v1/healthz` (process), `/api/v1/statusz` (đọc
  song song 2 upstream, 503 nếu 1 cái chưa sẵn); upstream `/api/v1/healthz`
  (public cho Render) vs `/api/v1/readyz` (cần gateway key); 1 `X-Request-Id` an
  toàn được log ở gateway và truyền suốt; không log secret hay body nghiệp vụ.

Chi tiết lý do (vì sao public upstream, khi nào lên paid/private) ở
[../vision/deployment.md](../vision/deployment.md).

## Checklist nhanh

- [ ] Neon: 2 logical DB, 4 URL (pooled+direct mỗi cái), `sslmode=require`.
- [ ] Blueprint synced; env group `myunivokai-gateway-secrets` link đủ 3 service.
- [ ] Biến `sync: false` đã nhập đủ (gateway 3, mỗi world service DB×2 +
      PUBLIC_WEB_URL; nature PUBLIC_WEB_URL có `/nature`).
- [ ] `healthz` 200 trên cả 3; `statusz` báo 2 upstream ready.
- [ ] Business route trực tiếp trả 401 khi thiếu `X-Gateway-Key`.
- [ ] Smoke create/get/regenerate/publish/share qua `/api/universe` và
      `/api/nature`.
- [ ] Vercel `NEXT_PUBLIC_*` trỏ gateway; redeploy KHÔNG build cache.
