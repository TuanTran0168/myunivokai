# Hướng dẫn deploy toàn bộ Myunivokai lên Render

> **Document status:** Current HTTP-platform runbook; target replacement approved
> **Last source review:** 2026-07-22

> **Do not use this runbook for the approved NATS/Redis migration.** It remains
> accurate for source and `render.yaml` reviewed on 2026-07-22. Sprint 1 replaces
> it at cutover; use
> [../sprints/sprint-01-2026-07-22/deployment-guide.md](../sprints/sprint-01-2026-07-22/deployment-guide.md)
> for the target fleet.

> Nội dung bên dưới là runbook thao tác cho kiến trúc HTTP cũ và `render.yaml`
> hiện tại vẫn là nguồn sự thật của hạ tầng đã có trong source. Thiết kế deploy
> đích nằm ở [Vision V1 deployment](../vision/versions/v1-2026-07-22/deployment.md); không trộn hai
> quy trình trước khi Sprint 1 cutover.

Tài liệu nền tảng đã đối chiếu: [Blueprint YAML Reference](https://render.com/docs/blueprint-spec),
[Docker on Render](https://render.com/docs/docker),
[Deploy a Next.js App](https://render.com/docs/deploy-nextjs-app), và
[Free instance limitations](https://render.com/docs/free).

## Kiến trúc deploy

```txt
Render: myunivokai-web
  NEXT_PUBLIC_GATEWAY_BASE_URL=https://<gateway-origin>
                    │
                    ▼
Render: myunivokai-gateway
  ├─ /api/universe/* ──> myunivokai-api    ──> Neon logical DB "universe"
  └─ /api/nature/*   ──> myunivokai-nature ──> Neon logical DB "nature"
```

Blueprint tạo bốn Docker web service:

| Service | Source | Vai trò |
| --- | --- | --- |
| `myunivokai-web` | `clients/web-client` | Next.js UI |
| `myunivokai-gateway` | `services/api-gateway` | API origin duy nhất của browser |
| `myunivokai-api` | `services/universe-service` | Universe domain |
| `myunivokai-nature` | `services/nature-service` | Nature domain |

Cả bốn dùng `autoDeployTrigger: checksPass`: Render chỉ auto-deploy commit sau
khi CI của repo xanh.

FE chỉ nhận **một** biến `NEXT_PUBLIC_GATEWAY_BASE_URL`, không có URL trực tiếp
tới Universe hay Nature. Helper FE tự thêm `/api/universe` hoặc `/api/nature`;
gateway mới là nơi biết hostname của hai peer service.

Hai peer vẫn có public hostname khi dùng Render Free vì free web service không
nhận private-network traffic. Mọi business route và readiness route của peer
yêu cầu `GATEWAY_SHARED_SECRET`; chỉ `/` và `/api/v1/healthz` public cho probe.

## Bước 0 — chuẩn bị

- [ ] Repo đã merge nhánh deploy vào `staging`, CI xanh, rồi merge `staging` vào
      `main` theo convention.
- [ ] Render đã kết nối GitHub repo và deploy từ `main`.
- [ ] Có một project Neon với hai logical database riêng.
- [ ] Chốt tên public của web và gateway. Ví dụ dưới đây giả định
      `https://myunivokai-web.onrender.com` và
      `https://myunivokai-gateway.onrender.com`.

Nếu Render cấp hostname khác, thay hostname thực tế ở tất cả biến tương ứng rồi
rebuild/redeploy. Không đưa path `/api/...` vào
`NEXT_PUBLIC_GATEWAY_BASE_URL`.

## Bước 1 — Neon: hai logical database, bốn connection string

Trong **một** Neon project:

1. Tạo database Universe, ví dụ `myunivokai`.
2. Tạo database Nature riêng, ví dụ `myunivokai_nature`.
3. Với mỗi database, lấy URL **pooled** cho runtime và URL **direct** cho
   migration; cả hai dùng `sslmode=require`.

| Biến | Universe | Nature |
| --- | --- | --- |
| `DATABASE_URL` | pooled URL, dbname Universe | pooled URL, dbname Nature |
| `DATABASE_DIRECT_URL` | direct URL, dbname Universe | direct URL, dbname Nature |

Không bao giờ trỏ Nature vào database Universe. Mỗi service sở hữu migrations,
worlds, variants, AI logs và shares của chính nó.

## Bước 2 — tạo Blueprint lần đầu

1. Render Dashboard → **New → Blueprint**.
2. Chọn repo và nhánh release `main` chứa `render.yaml`.
3. Render hiển thị bốn service và env group
   `myunivokai-gateway-secrets`.
4. Trong luồng tạo Blueprint, Render hỏi giá trị cho các biến `sync: false`.
   Nhập theo Bước 3 rồi Apply.

`GATEWAY_SHARED_SECRET` không nhập tay. Blueprint sinh một giá trị 256-bit duy
nhất trong env group và gắn cùng giá trị đó vào gateway, Universe và Nature.

## Bước 3 — điền biến môi trường

### `myunivokai-web`

| Biến | Giá trị |
| --- | --- |
| `NEXT_PUBLIC_GATEWAY_BASE_URL` | origin HTTPS của gateway, ví dụ `https://myunivokai-gateway.onrender.com` |

Đây là build-time public configuration, không phải secret. Render chuyển env
của Docker service thành build argument, và Dockerfile khai báo đúng `ARG`
tương ứng. Sau mọi lần đổi giá trị này phải **Save, rebuild, and deploy** để
Next.js compile lại bundle. Docker build từ chối chạy nếu biến này rỗng, tránh
deploy nhầm bundle đang trỏ về localhost.

### `myunivokai-gateway`

| Biến | Giá trị |
| --- | --- |
| `API_ALLOWED_ORIGINS` | origin HTTPS của web, không wildcard, không path |
| `UNIVERSE_SERVICE_URL` | public HTTPS origin của `myunivokai-api`, không `/api/...` |
| `NATURE_SERVICE_URL` | public HTTPS origin của `myunivokai-nature`, không `/api/...` |

`APP_ENV=production`, `TRUST_PROXY=true` và shared secret đã có từ Blueprint.
Gateway từ chối khởi động production nếu origin/URL sai, upstream không dùng
HTTPS, CORS rỗng/wildcard, hoặc shared secret ngắn hơn 32 ký tự.

### `myunivokai-api`

| Biến | Giá trị |
| --- | --- |
| `DATABASE_URL` | Universe pooled URL |
| `DATABASE_DIRECT_URL` | Universe direct URL |
| `PUBLIC_WEB_URL` | web origin, không path |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | để trống khi chạy mock; nhập khi bật provider thật |

### `myunivokai-nature`

| Biến | Giá trị |
| --- | --- |
| `DATABASE_URL` | Nature pooled URL |
| `DATABASE_DIRECT_URL` | Nature direct URL |
| `PUBLIC_WEB_URL` | `<web-origin>/nature` |

Nature phải có `/nature` trong `PUBLIC_WEB_URL` để share URL rơi vào route
`/nature/share/worlds/{slug}`. Blueprint hiện đặt cả hai service ở
`AI_PROVIDER=mock`, `AI_FALLBACK_PROVIDER=mock` và
`RUN_MIGRATIONS_ON_START=true`. Universe hỗ trợ provider thật; Nature hiện mới
wire mock theo source.

## Bước 4 — rollout theo thứ tự

1. Kiểm tra lần cuối bốn Neon URL đúng logical database.
2. Deploy Universe và Nature; entrypoint chạy migration bằng direct URL trước
   khi mở API.
3. Xác nhận peer liveness:
   - `GET https://<universe>/api/v1/healthz` → 200;
   - `GET https://<nature>/api/v1/healthz` → 200.
4. Deploy gateway sau khi hai peer sống.
5. Deploy/rebuild web sau khi gateway có hostname đúng.

Nếu Blueprint deploy đồng thời ở lần đầu, gateway/web có thể đỏ tạm thời trong
khi peer cold-start hoặc biến hostname chưa khớp. Sửa giá trị theo hostname
Render thực cấp rồi redeploy theo thứ tự trên.

## Bước 5 — smoke test

### Security boundary

Gọi thẳng peer mà không có key:

```bash
curl -i https://<universe>/api/v1/readyz
curl -i https://<nature>/api/v1/worlds
```

Cả hai phải trả 401. Không gửi `GATEWAY_SHARED_SECRET` từ máy người dùng hoặc
frontend để smoke test; secret chỉ sống trong Render.

### Gateway health và routing

```bash
curl -i https://<gateway>/api/v1/healthz
curl -i https://<gateway>/api/v1/statusz
```

`healthz` phải 200. `statusz` phải 200 và báo cả hai upstream ready; 503 trong
lúc cold start là hợp lệ, chờ peer thức rồi gọi lại.

Smoke create qua cả hai prefix bằng payload trong README của service:

```bash
curl -X POST https://<gateway>/api/universe/worlds \
  -H "Content-Type: application/json" \
  -d '{...}'

curl -X POST https://<gateway>/api/nature/worlds \
  -H "Content-Type: application/json" \
  -d '{...}'
```

Sau create, test get, regenerate, select, publish và share qua gateway. Không
smoke business route trực tiếp trên peer.

### Web client

1. Mở `https://<web>` và tạo một Universe world.
2. Tạo một Nature world.
3. Trong browser Network, xác nhận mọi API request chỉ đi tới một gateway host;
   endpoint mang prefix `/api/universe` hoặc `/api/nature`.
4. Kiểm tra cả hai share route và metadata.
5. Kiểm tra response CORS từ gateway cho đúng web origin.

## Cập nhật Blueprint đã tồn tại

Khi thêm `sync: false` mới vào Blueprint đã có, Render không tự có giá trị để
điền. Trước hoặc ngay sau khi sync branch này:

1. Thêm `myunivokai-web` vào Blueprint.
2. Nhập `NEXT_PUBLIC_GATEWAY_BASE_URL` cho web.
3. Xác nhận gateway có đủ `API_ALLOWED_ORIGINS`, `UNIVERSE_SERVICE_URL` và
   `NATURE_SERVICE_URL`.
4. Xác nhận env group sinh secret vẫn link đúng cả ba backend process.
5. Rebuild web; sau đó rollout peer → gateway → web.

## Bảng biến tổng hợp

| Biến | web | gateway | universe | nature | Nguồn |
| --- | :---: | :---: | :---: | :---: | --- |
| `NEXT_PUBLIC_GATEWAY_BASE_URL` | ✓ | | | | Dashboard; public build arg |
| `APP_ENV=production` | | ✓ | ✓ | ✓ | `render.yaml` |
| `TRUST_PROXY=true` | | ✓ | | | `render.yaml` |
| `RUN_MIGRATIONS_ON_START=true` | | | ✓ | ✓ | `render.yaml` |
| `AI_PROVIDER` / `AI_FALLBACK_PROVIDER` | | | `mock` | `mock` | `render.yaml` |
| `GATEWAY_SHARED_SECRET` | | ✓ | ✓ | ✓ | generated env group |
| `API_ALLOWED_ORIGINS` | | ✓ | | | Dashboard |
| `UNIVERSE_SERVICE_URL` / `NATURE_SERVICE_URL` | | ✓ | | | Dashboard |
| `DATABASE_URL` / `DATABASE_DIRECT_URL` | | | ✓ | ✓ | Dashboard, Neon |
| `PUBLIC_WEB_URL` | | | ✓ | ✓ + `/nature` | Dashboard |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | | | optional | N4 chưa wire | Dashboard |

## Localhost theo cùng kiến trúc

Từ root repo:

```bash
docker compose -f docker-compose-local.yml up --build
```

Compose khởi động hai PostgreSQL, hai migration job, hai peer, gateway, rồi web.
FE chỉ nhận `NEXT_PUBLIC_GATEWAY_BASE_URL=http://localhost:8082`, giống production.
Các URL mặc định:

| Thành phần | URL |
| --- | --- |
| web | `http://localhost:3000` |
| gateway | `http://localhost:8082` |
| gateway status | `http://localhost:8082/api/v1/statusz` |
| Universe Swagger | `http://localhost:8080/swagger/index.html` |
| Nature Swagger | `http://localhost:8081/swagger/index.html` |

Dừng stack nhưng giữ volume database:

```bash
docker compose -f docker-compose-local.yml down
```

## Free-tier và production thực

Blueprint đang để `plan: free` cho cả bốn web service để có thể thử/hobby deploy.
Free instances sleep độc lập và cùng tiêu thụ quota giờ của workspace; một lượt
lạnh có thể phải đánh thức web → gateway → peer. Render ghi rõ free plan không
phù hợp formal production và free web service không nhận private-network
traffic.

Dependency gate được chạy lại ngày 2026-07-18:
`npm audit --omit=dev --audit-level=high` thất bại với **2 advisory** trong cây
production (1 high trên Next.js 14 và 1 moderate trên PostCSS kéo theo bởi
Next); npm đề xuất Next 16.2.10 bằng một breaking major. Đây là migration
framework riêng, không được ép vào branch deploy bằng `npm audit fix --force`.
Có thể dùng Blueprint free để test/hobby, nhưng không đánh dấu formal
production cho tới khi branch nâng Next làm audit gate xanh.

Khi có traffic thật, nâng plan gateway và peer trước khi đặt SLO. Việc chuyển
peer sang private service cần một migration hạ tầng riêng và thay validation
upstream HTTP nội bộ trong gateway; không tự đổi chỉ bằng URL dashboard trên
branch này.

## Checklist nhanh

- [ ] Hai logical Neon DB, bốn URL pooled/direct đúng database.
- [ ] Blueprint có đủ bốn service và một shared-secret env group.
- [ ] Web chỉ có một `NEXT_PUBLIC_GATEWAY_BASE_URL`, không kèm `/api/...`.
- [ ] Gateway CORS đúng web origin; hai upstream là public HTTPS origin.
- [ ] `healthz` xanh trên ba backend process; `statusz` báo hai peer ready.
- [ ] Direct peer business route trả 401 khi thiếu key.
- [ ] Universe và Nature create/get/share thành công qua gateway.
- [ ] Browser Network chỉ xuất hiện gateway host cho API calls.
- [ ] Trước formal production: `npm audit --omit=dev --audit-level=high` xanh.
- [ ] Không có API key, DB URL hay shared secret trong git hoặc frontend bundle.
