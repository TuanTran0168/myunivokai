# Hướng Dẫn Triển Khai Backend Lên Koyeb (Single-Container)

> **Trạng thái:** Build artifact đã được build + smoke-test thành công cục bộ
> (`deploy/single-container/`). **Chưa deploy thật lên Koyeb** — tài liệu này
> là hướng dẫn từng bước để làm điều đó, không phải xác nhận nó đã chạy trên
> Koyeb.
> **Đọc trước:** `deploy/single-container/README.md` — phần research so
> sánh Hugging Face Spaces vs Koyeb, vì sao Hugging Face bị loại (Docker SDK
> giờ cần trả phí), và những giới hạn thật của Koyeb free tier (512MB RAM,
> 0.1 vCPU, vẫn sleep sau 1h idle — khác với giả định ban đầu là "không
> sleep"). Tài liệu này không lặp lại phần đó, chỉ tập trung vào **các bước
> deploy**.

## 0. Điểm khác biệt so với `notes/ops/production-deployment-guide.md`

Guide kia triển khai **8 service riêng biệt** lên Render, mỗi service một
container/URL. Guide này triển khai **cùng 8 tiến trình đó gộp vào một
container duy nhất** (`api-gateway`, `dna`, `universe`, `nature`, `ocean`,
`auth`, `analytics`, `telemetry`), chạy qua `supervisord`, lên **một** Koyeb
Service. Hai điểm hệ quả:

- **Không cần cơ chế đánh thức (`SERVICE_WAKE_PLATFORM`).** Cả 8 tiến trình
  luôn chạy cùng lúc trong cùng container — không có "service đang ngủ" để
  đánh thức. `supervisord.conf` đã set cứng `SERVICE_WAKE_PLATFORM=none` cho
  gateway; không cần các biến `*_SERVICE_URL`.
- **`myunivokai-web` và `myunivokai-admin` KHÔNG nằm trong scope này.**
  `myunivokai-web` tiếp tục chạy Vercel như hiện tại. `myunivokai-admin` cần
  một chỗ chạy riêng (Vercel, hoặc một Koyeb Service Docker thứ hai dùng
  `apps/myunivokai-admin/Dockerfile.prod` sẵn có) — xem
  `deploy/single-container/README.md#frontends-are-explicitly-out-of-scope-here`
  để hiểu vì sao gộp admin vào chung container này chưa an toàn (cookie path
  cứng).

Phần 1-3 dưới đây (Neon, Upstash, Synadia) **giống hệt**
`production-deployment-guide.md`, chỉ khác ở đích deploy (Koyeb thay vì
Render) — đọc lướt nếu đã làm qua guide kia rồi.

---

## 1. Chuẩn Bị Tài Nguyên (giống Render, khác đích deploy)

### 1.1. Neon Postgres — 7 database

Khác Render (5 database), single-container cần đủ **7** — thêm `ocean` và
`telemetry` so với `production-deployment-guide.md` §2.1 (viết trước khi hai
service này tồn tại):

```
myunivokai_dna
myunivokai_universe
myunivokai_nature
myunivokai_ocean
myunivokai_auth
myunivokai_analytics
myunivokai_telemetry
```

Với mỗi database: vào **Connection Details**, tick **Pooled connection** lấy
`DATABASE_URL`, bỏ tick lấy `DATABASE_DIRECT_URL` (dùng để migrate — mỗi
`cmd/service/main.go` tự chạy migration lúc khởi động, xem
`production-deployment-guide.md` §5, không cần chạy tay).

Nếu giới hạn Project của Neon chặn, gộp nhiều database vào **cùng một
Project** dưới dạng database riêng biệt (không gộp chung schema).

### 1.2. Upstash Redis — dùng chung 1 instance

Giống hệt `production-deployment-guide.md` §2.2. Một Redis URL
(`rediss://...`), dùng chung cho `api-gateway` (cache/rate-limit) và `auth`
(tokenVersion revocation).

### 1.3. Synadia Cloud NATS (NGS) — 1 file `.creds`

Giống hệt `production-deployment-guide.md` §2.3. Tạo Account + User trên
Synadia Cloud, tải file `.creds`. **Mở file này bằng text editor và copy
TOÀN BỘ nội dung** (bao gồm cả hai khối `-----BEGIN NATS USER JWT-----` và
`-----BEGIN USER NKEY SEED-----`) — nội dung này sẽ dán vào biến
`NATS_CREDS_CONTENT` ở bước 3, KHÔNG dùng cơ chế Secret File của Render (xem
`deploy/single-container/docker-entrypoint.sh` để hiểu vì sao).

### 1.4. Khoá ký JWT cho Auth Service

Giống hệt `production-deployment-guide.md` §2.4:

```bash
openssl rand -base64 32
```

⛔ Không dùng lại giá trị trong `.env.local`/`.env.example` của repo — đó là
khoá throwaway chỉ dùng local. Sinh khoá mới, không lưu vào bất kỳ file nào
trong repo.

---

## 2. Đưa Code Lên Koyeb

Koyeb build trực tiếp từ Dockerfile trong repo Git (giống Render), không cần
tự build/push image thủ công trừ khi muốn kiểm tra trước.

### 2.1. (Khuyến nghị) Build + smoke-test cục bộ trước khi trỏ Koyeb vào repo

```bash
# Từ thư mục gốc repo — bắt buộc, vì mọi go.mod phụ thuộc contracts/go
# (và telemetry-service phụ thuộc contracts/rust) ở đường dẫn tương đối cố định.
docker build -f deploy/single-container/Dockerfile -t myunivokai-services-koyeb .

# Chạy thử với biến môi trường thật (copy từ deploy/single-container/.env.example
# thành deploy/single-container/.env rồi điền giá trị thật, KHÔNG commit file này).
# NATS_CREDS_CONTENT truyền riêng bằng -e chứ không qua --env-file: định dạng
# --env-file của Docker là line-based, không giữ được value nhiều dòng, còn
# biến shell thì được — đặt nguyên nội dung file .creds vào
# deploy/single-container/.env.nats-creds (cũng bị .gitignore chặn, khớp
# pattern .env.*) rồi đọc nó khi chạy:
docker run --rm -p 8080:8080 \
  --env-file deploy/single-container/.env \
  -e NATS_CREDS_CONTENT="$(cat deploy/single-container/.env.nats-creds)" \
  myunivokai-services-koyeb
curl http://localhost:8080/api/v1/healthz
```

Nếu bước này chạy được cục bộ với thông tin thật, Koyeb build cùng
Dockerfile gần như chắc chắn cũng chạy được — sự khác biệt duy nhất là môi
trường mạng (Koyeb có thể chặn outbound tới Neon/Upstash/Synadia theo cách
khác, xem mục Troubleshooting).

### 2.2. Tạo Koyeb App + Service

1. Đăng nhập [Koyeb](https://app.koyeb.com), tạo **App** mới (ví dụ
   `myunivokai`).
2. Trong App đó, tạo **Service** mới:
   - **Deployment method:** GitHub (kết nối repo) hoặc Docker image (nếu tự
     build/push lên registry riêng — Docker Hub, GHCR).
   - Nếu chọn GitHub: trỏ **Dockerfile path** vào
     `deploy/single-container/Dockerfile`, **Build context** vào thư mục gốc
     repo (`.`) — bắt buộc, lý do giống hệt `dockerContext: .` trong
     `render.yaml` cho mọi service khác.
   - **Instance type:** Free (0.1 vCPU / 512MB RAM). Xem
     `deploy/single-container/README.md` phần "resource fit" nếu build/khởi
     động timeout — có thể cần nâng lên Nano/Micro trả phí.
   - **Port:** `8080` (khớp `EXPOSE 8080` trong Dockerfile và biến `PORT`
     mặc định trong `.env.example`).
   - **Region:** Frankfurt hoặc Washington D.C. (hai lựa chọn duy nhất cho
     Free Instance).

### 2.3. Điền biến môi trường

Copy từng dòng trong `deploy/single-container/.env.example` vào tab
**Environment variables** của Service trên Koyeb. Bảng dưới liệt kê nhóm nào
lấy giá trị từ đâu (đối chiếu với bước 1):

| Biến | Nguồn |
| --- | --- |
| `PORT` | `8080`, giữ nguyên |
| `NATS_URL` | `tls://connect.ngs.global:4222`, giữ nguyên |
| `NATS_CREDS_CONTENT` | Toàn bộ nội dung file `.creds` (bước 1.3) |
| `REDIS_URL` | Upstash (bước 1.2) |
| `API_ALLOWED_ORIGINS` | Domain thật của `myunivokai-web` (Vercel), không có `/` cuối |
| `ADMIN_ROUTES_ENABLED` / `ADMIN_ALLOWED_ORIGIN` / `ADMIN_ACCESS_PUBLIC_KEYS` | Chỉ điền nếu `myunivokai-admin` đã có chỗ chạy riêng — xem mục 0 |
| `*_DATABASE_URL` / `*_DATABASE_DIRECT_URL` (×7) | Neon (bước 1.1), mỗi service một cặp |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | Theo `production-deployment-guide.md` §4.2 Service 2 |
| `UNIVERSE_PUBLIC_WEB_URL` / `NATURE_PUBLIC_WEB_URL` / `OCEAN_PUBLIC_WEB_URL` | Domain thật của `myunivokai-web` + đúng path family (`/universe`, `/nature`, `/ocean`) — code nối thẳng `PUBLIC_WEB_URL + "/share/" + slug`, không tự thêm path, nên thiếu path này link share sẽ sai |
| `AUTH_ACCESS_PRIVATE_KEY` | Khoá vừa sinh (bước 1.4) |
| `TELEMETRY_OTLP_ENDPOINT`, `TELEMETRY_DASHBOARD_URL` | Để trống trừ khi dùng `TELEMETRY_SINK=otlp` (mặc định `postgres`) |

⚠️ **Không bỏ trống bất kỳ biến nào ở bảng trên nếu service tương ứng cần
nó** — nhưng nếu lỡ quên một biến KHÔNG bắt buộc (ví dụ `GEMINI_API_KEY` khi
dùng `AI_PROVIDER=mock`), container vẫn khởi động bình thường:
`docker-entrypoint.sh` đã default mọi biến optional về rỗng trước khi
supervisord đọc, nên thiếu một biến optional chỉ khiến MỘT tiến trình báo
lỗi rõ ràng của riêng nó, không kéo sập cả 8 tiến trình (xem README phần
"Why docker-entrypoint.sh defaults every optional variable" để hiểu bug đã
tìm và vá trong quá trình build thử).

### 2.4. Deploy

Bấm **Deploy**. Lần build đầu chậm (biên dịch 7 Go module + 1 Rust crate từ
đầu, đã đo cục bộ ~2-3 phút cho phần Rust một mình). Theo dõi log build; nếu
build fail, thường là lỗi Dockerfile path/context (mục 2.2), không phải lỗi
biến môi trường (biến môi trường chỉ ảnh hưởng lúc *chạy*, không ảnh hưởng
lúc *build*).

---

## 3. Xác Minh Sau Khi Deploy

### 3.1. Health check

```bash
curl https://<koyeb-service-url>/api/v1/healthz
# Kỳ vọng: {"service":"Myunivokai API Gateway","status":"ok"}
```

Nếu Koyeb báo container không bao giờ "healthy": xem log — nhiều khả năng
một trong bảy service worker crash-loop vì thiếu `DATABASE_URL`/
`AUTH_ACCESS_PRIVATE_KEY` (log của service đó sẽ nói rõ tên biến thiếu, xem
mục Troubleshooting), khiến supervisord liên tục restart nó — nhưng
**gateway vẫn trả lời healthz bình thường** vì các tiến trình là độc lập,
nên "container unhealthy" theo nghĩa Koyeb hiểu (health check trên port
8080) và "một service con crash-loop" là hai việc khác nhau, cần đọc log để
phân biệt.

### 3.2. Đọc log tách theo từng service

`supervisord.conf` ghi log của mỗi tiến trình ra `stdout`/`stderr` riêng
(không gộp vào một file), nhưng Koyeb gộp tất cả log của container thành một
luồng — mỗi dòng log của các service Go/Rust đã là JSON có field cố định
(`level`, `time`, `message`, và với gateway/dna/universe/nature/ocean/auth/
analytics/telemetry sau bản cập nhật log ở
`notes/be/rust-service-architecture.md`/từng service, còn có `subject` cho
mỗi request/job NATS đi qua) — lọc theo service bằng cách `grep` message
gốc, ví dụ `grep '"message":"dna message processed"'` để chỉ xem log của
dna-service.

### 3.3. Kiểm tra migration đã chạy

```bash
# Từ máy có psql, dùng DATABASE_DIRECT_URL của từng database:
psql "$DNA_DATABASE_DIRECT_URL" -c "\dt"
```

Mỗi `cmd/service/main.go` tự migrate lúc khởi động (xem
`production-deployment-guide.md` §5) — nếu bảng không tồn tại, đọc log của
service đó, dòng `log.Fatal` sẽ nói rõ lỗi migration.

### 3.4. Kiểm tra pipeline NATS đầu-cuối

Giống cách kiểm tra local trong
`services/telemetry-service/README.md#verifying-the-whole-pipeline-locally`,
chỉ đổi NATS server sang Synadia:

```bash
nats --creds nats.creds --server tls://connect.ngs.global:4222 \
  request myunivokai.queries.telemetry.overview.get.v1 \
  '{"jobId":"manual-check","timestamp":"2026-08-22T15:00:00Z","data":{"hours":24}}'
```

Trả về JSON có `chartsAvailable` nghĩa là telemetry-service (và do đó cả
đường truyền NATS) đang sống.

---

## 4. Troubleshooting

Phần lớn lỗi ở đây **giống hệt** `production-deployment-guide.md` §6 vì cùng
codebase, cùng Neon/Upstash/Synadia — đọc mục 5.1 (`Authorization
Violation`), 5.2 (`max ack pending`), 5.4 (`outbox_messages does not
exist`), 5.7 (auth-service thiếu biến) ở guide đó trước. Dưới đây chỉ liệt
kê phần **khác biệt riêng của single-container**.

### 4.1. Một service báo thiếu biến, bảy service còn lại vẫn chạy bình thường

Đây là hành vi **đúng như thiết kế**, không phải một service kéo sập cả
container — xem `deploy/single-container/README.md` phần
"Why docker-entrypoint.sh defaults every optional variable". Đọc log của
đúng service đó (lọc theo message, mục 3.2), sửa đúng biến nó cần, Koyeb sẽ
tự redeploy nếu bạn sửa biến môi trường qua dashboard.

### 4.2. `PORT` bị trùng giữa các tiến trình con

Sáu trong bảy worker Go tự bind một health server nội bộ trên `$PORT`, mặc
định `:8080` nếu biến trống (xem `cmd/service/main.go` mỗi service).
`supervisord.conf` đã gán cứng cho mỗi worker một `PORT` khác nhau
(8082-8087, telemetry dùng 8081) — nếu bạn tự thêm một tiến trình thứ chín
vào `supervisord.conf`, nhớ tránh dải cổng này và cổng 8080 (dành cho
gateway/platform).

### 4.3. Container build thành công nhưng khởi động rất chậm / bị Koyeb coi là unhealthy quá sớm

0.1 vCPU nghĩa là 8 tiến trình cùng mở kết nối NATS + 6 migration Postgres
chạy gần như đồng thời trên một lõi CPU rất yếu — chưa đo trên Koyeb thật
(xem README phần "unverified"). Nếu health check timeout trước khi container
kịp sẵn sàng, thử: (a) tăng health check grace period trên Koyeb nếu có tuỳ
chọn, (b) tạm nâng Instance type lên Nano để xác nhận đây đúng là vấn đề tài
nguyên chứ không phải lỗi cấu hình, trước khi quyết định có ở lại Free tier
hay không.

### 4.4. Cần trỏ `myunivokai-web` (Vercel) sang gateway mới trên Koyeb

Đổi `NEXT_PUBLIC_GATEWAY_BASE_URL` trên Vercel thành URL Koyeb Service (ví
dụ `https://myunivokai-xxxx.koyeb.app`), redeploy `myunivokai-web`. Đồng thời
cập nhật `API_ALLOWED_ORIGINS` trên Koyeb khớp domain Vercel thật — CORS
kiểm tra khớp chính xác (không có `/` cuối), sai một ký tự sẽ khiến mọi
request từ trình duyệt bị chặn ở bước preflight, không phải lỗi backend.
