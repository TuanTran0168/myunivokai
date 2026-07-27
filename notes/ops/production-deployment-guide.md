# Hướng Dẫn Triển Khai Lên Môi Trường Production (Production Deployment Guide)

> **Cập nhật lần cuối:** 2026-07-26 (thêm mục 5.4–5.6: auto-migrate, connection limit do thiếu port, healthz server)
> **Trạng thái:** Active & Tested trên Production

Tài liệu này hướng dẫn chi tiết từng bước (step-by-step) cách cấu hình và triển khai (deploy) toàn bộ hệ thống Microservices của dự án MyUnivokai lên các nền tảng đám mây (Cloud).

---

## 1. Tổng quan Kiến Trúc Hệ Thống

Dự án MyUnivokai được cấu thành từ 5 thành phần cốt lõi phân tán trên nhiều nền tảng:

1. **Frontend (Vercel):** Ứng dụng Next.js.
2. **Backend (Render):** Hệ thống gồm 4 Microservices viết bằng Go (`api-gateway`, `dna-service`, `universe-service`, `nature-service`). Tất cả được deploy dưới dạng `Web Service` để tối ưu chi phí (sử dụng gói Free của Render).
3. **Database (Neon.tech):** Cơ sở dữ liệu PostgreSQL Serverless (gồm 3 database độc lập cho 3 service).
4. **Cache & Rate Limit (Upstash):** Dịch vụ Redis Serverless.
5. **Message Broker (Synadia Cloud - NGS):** Mạng lưới NATS JetStream đảm nhiệm việc giao tiếp không đồng bộ (asynchronous messaging) giữa các Microservices.

---

## 2. Hướng Dẫn Chuẩn Bị Tài Nguyên Từng Bước

### Bước 2.1: Thiết lập Database trên Neon.tech
Hệ thống sử dụng mô hình Database-per-service. Bạn cần tạo 3 database riêng biệt.
1. Đăng nhập vào [Neon.tech](https://neon.tech/) và tạo một Project mới (Ví dụ: `myunivokai-db-prod`).
2. Vào mục **Databases**, tạo lần lượt 3 database:
   - `myunivokai_dna`
   - `myunivokai_universe`
   - `myunivokai_nature`
3. Vào mục **Dashboard** -> **Connection Details**:
   - Tích chọn **Pooled connection** (để dùng PGBouncer). Copy chuỗi kết nối (thường có `?sslmode=require`). Đây chính là `DATABASE_URL`.
   - Bỏ tích **Pooled connection**. Copy chuỗi kết nối trực tiếp. Đây là `DATABASE_DIRECT_URL` (dùng để chạy Migration).

### Bước 2.2: Thiết lập Redis trên Upstash
1. Đăng nhập vào [Upstash](https://upstash.com/) và tạo một Redis Database mới (Ví dụ: `myunivokai-redis-prod`).
2. Kéo xuống mục **Connect to your database** ở trang Dashboard.
3. Chuyển sang tab **Redis CLI** hoặc **URI**. Copy toàn bộ chuỗi URL bắt đầu bằng `rediss://...`. Đây chính là `REDIS_URL`.

### Bước 2.3: Thiết lập NATS JetStream trên Synadia Cloud (NGS)
> ⚠️ **CẢNH BÁO QUAN TRỌNG:** 
> Synadia cung cấp 2 loại chứng thực: 
> 1. Personal Access Token (bắt đầu bằng `nhg_...`): Chỉ dùng để gọi REST API (HTTP).
> 2. File Credentials (`.creds`): Chứa NKey Seed và User JWT. **BẮT BUỘC PHẢI DÙNG FILE NÀY** để kết nối các Go Microservices thông qua giao thức TCP của NATS.

1. Đăng nhập vào Synadia Cloud.
2. Tạo Account, sau đó tạo một User mới (Ví dụ: `myunivokai_prod_user`).
3. Tải file thông tin xác thực về máy tính (file sẽ có đuôi là `.creds`). Mở file này bằng trình soạn thảo văn bản (Notepad/VS Code), bạn sẽ thấy cấu trúc gồm `-----BEGIN NATS USER JWT-----` và `-----BEGIN USER NKEY SEED-----`. Giữ nguyên nội dung này cho bước sau.

---

## 3. Cấu Hình Biến Môi Trường Dùng Chung (Environment Groups) Trên Render

Vì 4 Go Services đều cần kết nối chung vào NATS, để tránh cấu hình lặp lại nhiều lần, chúng ta sẽ tạo một nhóm biến môi trường dùng chung.

1. Đăng nhập vào [Render Dashboard](https://dashboard.render.com).
2. Ở cột menu bên trái, chọn **Env Groups** -> Bấm **New Environment Group**.
3. Đặt tên là: `myunivokai-shared-env`.
4. Kéo xuống phần **Secret Files**:
   - Bấm **Add Secret File**.
   - Tại ô **Filename**: Nhập chính xác tên `nats.creds`.
   - Tại ô **Contents**: Dán toàn bộ nội dung của file `.creds` mà bạn đã tải từ Synadia ở Bước 2.3.
5. Cuộn lên phần **Environment Variables**, thêm các biến sau:
   - Khóa: `NATS_URL` | Giá trị: `tls://connect.ngs.global:4222`
   - Khóa: `NATS_CREDENTIALS` | Giá trị: `/etc/secrets/nats.creds`
   > ⛔ **Lưu ý:** Tuyệt đối KHÔNG khai báo biến `NATS_USERNAME` và `NATS_PASSWORD`.
6. Bấm **Create Environment Group**.

---

## 4. Triển Khai Backend Lên Render (Render Blueprint)

Hệ thống đã được thiết kế sẵn file `render.yaml` (Infrastructure as Code). Khi bạn push code lên GitHub, Render sẽ tự động nhận diện và tạo ra 4 Web Services.

### Bước 4.1: Liên kết (Link) Environment Group
1. Lần lượt bấm vào từng Service trên Render Dashboard (`myunivokai-gateway`, `myunivokai-dna`, `myunivokai-universe`, `myunivokai-nature`).
2. Chuyển sang tab **Environment**.
3. Ở mục **Linked Environment Groups**, bấm **Link** và chọn nhóm `myunivokai-shared-env`. Bấm Save.

### Bước 4.2: Điền Các Biến Môi Trường Đặc Thù Cho Từng Service
Vẫn ở tab **Environment** của từng Service, điền các giá trị đặc thù sau vào mục **Environment Variables** (Các biến này đã được khai báo sẵn khung trong `render.yaml`, bạn chỉ cần điền giá trị):

#### 🚀 Service 1: API Gateway (`myunivokai-gateway`)
- `API_ALLOWED_ORIGINS`: `https://myunivokai.vercel.app` (Lưu ý: Không có dấu `/` ở cuối).
- `REDIS_URL`: Dán chuỗi kết nối Upstash Redis từ Bước 2.2.

#### 🚀 Service 2: DNA Service (`myunivokai-dna`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_dna` (Bước 2.1).
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_dna`.
- `GEMINI_API_KEY`: API Key của nền tảng AI Google Gemini.
- `OPENAI_API_KEY`: API Key của nền tảng AI OpenAI.

#### 🚀 Service 3: Universe Service (`myunivokai-universe`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_universe`.
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_universe`.
- `PUBLIC_WEB_URL`: `https://<web-origin>/universe` — **có** hậu tố `/universe`,
  đối xứng với nature. Trang share của universe là `/universe/share/worlds/{slug}`.

#### 🚀 Service 4: Nature Service (`myunivokai-nature`)
- `DATABASE_URL`: Dán chuỗi kết nối Pooled của database `myunivokai_nature`.
- `DATABASE_DIRECT_URL`: Dán chuỗi kết nối Direct của database `myunivokai_nature`.
- `PUBLIC_WEB_URL`: `https://<web-origin>/nature` — **có** hậu tố `/nature`, vì
  trang share của forest nằm dưới prefix đó: `/nature/share/worlds/{slug}`.

> ⚠️ **BẮT BUỘC ĐỔI KHI DEPLY BẢN NÀY.** Trước đây universe **không** có hậu tố;
> giờ hai service dùng chung một dạng: `<web-origin>/<family>`. Cả hai đều đặt
> `sync: false` trong `render.yaml`, nghĩa là **phải nhập tay trên Render
> dashboard** — sửa file này không tự cập nhật service đang chạy.
>
> Nếu quên đổi: universe-service vẫn in ra `shareUrl` dạng cũ
> `<origin>/share/worlds/{slug}`. Link đó **vẫn hoạt động** (route cũ được giữ
> làm redirect 308 vĩnh viễn sang `/universe/...`), nên không có gì gãy — chỉ là
> link phát ra chưa ở dạng chuẩn. Đây là lý do route cũ
> `app/share/worlds/[shareSlug]/page.tsx` **không được xoá**: mọi `shareUrl` đã
> lưu trong database universe đều trỏ vào đó.

Sau khi lưu lại, Render sẽ tự động tiến hành build Docker image từ các file `Dockerfile.prod` và khởi động các services. 

---

## 5. Database Migrations (Tự Động Chạy Khi Service Khởi Động)

> **Cập nhật 2026-07-26:** Phiên bản trước của tài liệu này yêu cầu chạy `go run cmd/migrate/main.go` thủ công.
> - Lý do trước đây phải chạy tay: Render Free tier không hỗ trợ `preDeployCommand`.
> - Từ commit `7aa4053`, mỗi service (`dna-service`, `universe-service`, `nature-service`) tự gọi `db.Migrate(...)` ngay trong `cmd/service/main.go`.
> - Lệnh migrate chạy trước khi service kết nối pool và trước khi start messaging runtime.
> - Migrate dùng `DATABASE_DIRECT_URL`, fallback về `DATABASE_URL` nếu biến đó thiếu.
> - Nếu migrate lỗi, service gọi `log.Fatal` và không start. Đây là fail-fast, thay cho việc chạy ngầm với bảng thiếu.

Điều kiện tiên quyết duy nhất: `DATABASE_DIRECT_URL` phải được điền đúng trên Render cho cả 3 service (theo Bước 4.2). Khi điều kiện đó được đáp ứng, migrate chạy tự động mỗi lần deploy. Không còn bước thủ công nào cần thực hiện.

Binary `cmd/migrate/main.go` vẫn tồn tại độc lập, dùng cho debug hoặc chạy migrate ngoài luồng deploy:
```bash
cd services/dna-service   # hoặc universe-service / nature-service
set DATABASE_DIRECT_URL="postgres://..." # (hoặc export trên Mac/Linux)
go run cmd/migrate/main.go
```

---

## 6. Các Chú Ý Quan Trọng & Xử Lý Sự Cố (Troubleshooting)

### 5.1. Lỗi Xác Thực NATS (`nats: Authorization Violation`)
- **Triệu chứng:** Xem log trên Render thấy gateway hoặc các service khác báo lỗi này liên tục rồi crash.
- **Cách xử lý:** 99% nguyên nhân là do bạn đang cố dùng Personal Access Token (`nhg_...`) thay vì file `.creds`. Hoặc bạn gõ sai tên biến môi trường (Ví dụ: gõ là `NATS_CREDENTIALS_FILE` trong khi code Go chỉ đọc `NATS_CREDENTIALS`). Hãy rà soát lại thật kỹ Bước 3.

### 5.2. Lỗi Giới Hạn Pull Subscriptions (`consumer max ack pending exceeds system limit`)
- **Triệu chứng:** DNA, Universe, Nature kết nối được NATS nhưng báo lỗi không thể tạo Consumer do vượt quá hạn mức 25,000 của hệ thống.
- **Cách xử lý:** Đây là hạn chế của tài khoản Synadia Free. Code đã được vá bằng cách thêm cờ cứng `nats.MaxAckPending(1000)` vào mọi lời gọi `PullSubscribe()` (Commit `661903b`). Tuyệt đối không xóa các dòng cấu hình này trong các file `internal/messaging/runtime.go`.

### 5.3. Giới Hạn Thời Gian Miễn Phí (750 Giờ/Tháng Của Render)
- Gateway service được thiết lập đường dẫn kiểm tra sức khỏe tại `/api/v1/healthz`. Render sẽ liên tục "ping" vào đường dẫn này 5s/lần. Điều này khiến Gateway không bao giờ "ngủ đông" (spin down) và sẽ ngốn sạch 744 giờ/tháng.
- Hãy chú ý giám sát giới hạn Free Hours của Render nếu bạn không nâng cấp lên các gói trả phí. Do mô hình Microservices phân mảnh, tài khoản Free có thể cạn kiệt tài nguyên rất nhanh.

### 5.4. Lỗi `relation "outbox_messages" does not exist` + `prepared statement name is already in use` (DNA/Universe/Nature)
- **Triệu chứng:**
  - Outbox publisher loop báo lỗi bảng không tồn tại.
  - Lỗi đó xen kẽ với `FATAL: prepared statement name is already in use (SQLSTATE 08P01)`.
  - Cả hai lặp liên tục mỗi ~500ms, theo chu kỳ `OUTBOX_POLL_INTERVAL`.
- **Nguyên nhân gốc:**
  - Bảng chưa được tạo trên Neon DB production, vì migration chưa từng chạy (xem mục 5).
  - Lỗi `prepared statement...` nhiều khả năng chỉ là hệ quả phụ của lỗi thiếu bảng, xảy ra trên cùng connection pool (pgx statement cache).
  - Đây không phải lỗi độc lập về PgBouncer.
  - Bằng chứng: sau khi migrate chạy xong (tự động, theo mục 5), lỗi này biến mất hoàn toàn trong log thực tế.
- **Cách xử lý:**
  - Xác nhận migrate đã chạy, tự động từ commit `7aa4053` hoặc thủ công theo mục 5.
  - Nếu lỗi `prepared statement` vẫn còn sau khi bảng đã tồn tại, đó là dấu hiệu khác: xung đột giữa pgx (extended/prepared-statement protocol) và Neon pooled connection (PgBouncer transaction-mode).
  - Trong trường hợp đó, cần sửa `internal/db/pool.go` để tắt statement cache, hoặc chuyển sang `QueryExecModeSimpleProtocol`.
  - Tính đến 2026-07-26, chưa cần sửa `pool.go`, vì lỗi đã biến mất sau khi migrate tự động chạy.

### 5.5. Lỗi `nats: maximum account active connections exceeded`
- **Triệu chứng:** Ngay sau khi build xong và Render hiển thị "Deploying...", service crash ngay lập tức với lỗi này.
- **Nguyên nhân gốc:**
  - Không phải do tài khoản Synadia vượt hạn mức connection thật.
  - DNA/Universe/Nature được khai báo `type: web` trong `render.yaml`, bắt buộc vì Free tier không hỗ trợ `type: worker`.
  - Bản chất 3 service này chỉ là NATS consumer thuần, không mở HTTP port nào.
  - Do đó Render báo "No open ports detected" và restart service liên tục.
  - Mỗi lần restart mở một connection NATS mới, trong khi connection cũ chưa kịp đóng sạch.
  - Connection dồn lại cho tới khi vượt hạn mức account.
- **Cách xử lý:** Xem mục 5.6. HTTP health server bind `$PORT` khiến Render ngừng coi service là "chết" và ngừng restart-loop. Sau khi áp dụng mục 5.6, lỗi này không còn xuất hiện lại trong log thực tế.

### 5.6. Lỗi `No open ports detected, continuing to scan...`
- **Triệu chứng:** Log Render lặp lại cảnh báo này vô hạn sau khi deploy DNA/Universe/Nature, kèm restart-loop (xem mục 5.5).
- **Nguyên nhân:** Render `type: web` yêu cầu container bind vào biến `$PORT` trong vài phút đầu, để deploy được coi là thành công. Ba service này không có HTTP server nên không đáp ứng được điều kiện đó.
- **Cách xử lý (Commit `3b8b71f`):**
  - Mỗi service (`dna-service`, `universe-service`, `nature-service`) mở thêm một `http.Server` tối thiểu.
  - Server đó chỉ có route `/healthz`, trả `200 OK`.
  - Server bind vào biến `PORT`, fallback về `8080` khi chạy local không có biến `PORT`.
  - Server chạy trong goroutine riêng, song song với vòng lặp consume NATS.
  - Không có xung đột port giữa các service: mỗi service là container riêng biệt, cả trên Render lẫn qua `docker-compose-local.yaml` (xem `include:` ở root `docker-compose-local.yaml`).
  - Port bên trong container không lộ ra host, trừ khi có mục `ports:` publish tường minh. Hiện chỉ `api-gateway` publish `8080:8080` ra host local.
- **Quyết định:** `healthCheckPath` trong `render.yaml` không được bật cho 3 service này.
  - Lý do: bật `healthCheckPath` khiến Render tự ping liên tục, khoảng 5s/lần (giống mục 5.3), để giữ service luôn thức.
  - Việc đó ngốn giờ Free tier (750h/tháng) rất nhanh, nếu áp dụng cho cả 3 worker cộng thêm gateway.
  - Đổi lại, bind port mà không bật `healthCheckPath` chỉ đủ để pass port detection lúc deploy.
  - Nó không ngăn được Render tự ngủ đông service sau ~15 phút không có HTTP traffic.
  - Hệ quả: DNA/Universe/Nature có thể ngủ đông và tạm ngừng xử lý job NATS.
  - Đây là đánh đổi có chủ đích, ưu tiên tiết kiệm giờ Free tier hơn uptime 24/7.
  - Xử lý job real-time liên tục đòi hỏi nâng cấp plan trả phí, hoặc bật lại `healthCheckPath` kèm ngân sách giờ tương ứng.
