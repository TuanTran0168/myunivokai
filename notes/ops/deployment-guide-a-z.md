# Hướng Dẫn Deploy MyUnivokai Toàn Tập (Từ A-Z)

> **Cập nhật lần cuối:** 2026-07-26
> **Trạng thái:** Active & Tested trên Production

Tài liệu này hướng dẫn chi tiết cách cấu hình và deploy toàn bộ hệ sinh thái Microservices của MyUnivokai lên các nền tảng Cloud (Vercel, Render, Neon, Upstash, Synadia).

---

## 1. Tổng quan Kiến Trúc Phân Tán (Microservices)

Hệ thống bao gồm 5 mảnh ghép chính:
1. **Frontend (Vercel):** Web App viết bằng Next.js.
2. **Backend (Render):** 4 Go Microservices (`api-gateway`, `dna-service`, `universe-service`, `nature-service`). Tất cả đều chạy dưới dạng `Web Service` để tận dụng gói Free của Render.
3. **Database (Neon.tech):** PostgreSQL serverless (cần 3 database riêng biệt).
4. **Cache/Rate Limit (Upstash):** Redis serverless.
5. **Message Broker (Synadia Cloud - NGS):** NATS JetStream đóng vai trò là "xương sống" giao tiếp không đồng bộ giữa 4 Go Microservices.

---

## 2. Chuẩn bị Cơ Sở Dữ Liệu (Databases)

### 2.1. PostgreSQL (Neon.tech)
1. Tạo 1 Project mới trên Neon.
2. Bên trong Project, tạo 3 Database: `myunivokai_dna`, `myunivokai_universe`, `myunivokai_nature`.
3. Lấy 2 loại chuỗi kết nối:
   - **`DATABASE_URL`**: Chuỗi kết nối có Pooler (thường có chữ `?sslmode=require`).
   - **`DATABASE_DIRECT_URL`**: Chuỗi kết nối trực tiếp (dùng cho công việc Migrate DB).

### 2.2. Redis (Upstash)
1. Tạo 1 Redis Database.
2. Copy chuỗi **`REDIS_URL`** (bắt đầu bằng `rediss://...`).

---

## 3. Chuẩn bị NATS JetStream (Synadia Cloud) - ⚠️ QUAN TRỌNG

Synadia (NGS) bảo mật kết nối NATS (giao thức TCP) bằng hệ thống NKey phi tập trung, **KHÔNG PHẢI** bằng Username/Password truyền thống hay Personal Access Token (PAT).

> 🚫 **Lưu ý cực kỳ quan trọng về Token (`nhg_...`)**:
> Chuỗi bắt đầu bằng `nhg_...` là Personal Access Token dành riêng cho **REST API (HTTP)** của Synadia (ví dụ để dùng lệnh `curl` tạo user). Bạn **tuyệt đối không được** dùng chuỗi này để kết nối Go Services vào mạng lưới NATS.

Để kết nối Go Services vào NATS, bạn **bắt buộc phải có file `.creds`** (User Credentials JWT & NKey Seed).

### 3.1. Tạo Environment Group trên Render (Để dùng chung cấu hình)
Vì 4 Go Services đều cần kết nối chung vào 1 mạng lưới NATS, bạn nên dùng chức năng **Environment Group** của Render để cấu hình 1 lần dùng cho cả 4:

1. Vào Render Dashboard -> **Env Groups** -> **New Environment Group**.
2. Đặt tên: `myunivokai-shared-env`.
3. Ở phần **Secret Files**:
   - Bấm **Add Secret File**.
   - **Filename**: `nats.creds`
   - **Contents**: Mở file `.creds` của bạn bằng Notepad (hoặc VS Code), copy toàn bộ nội dung (từ `-----BEGIN NATS USER JWT-----` đến hết đoạn `------END USER NKEY SEED------`) và dán vào đây.
4. Ở phần **Environment Variables**, thêm 2 biến:
   - `NATS_URL` = `tls://connect.ngs.global:4222`
   - `NATS_CREDENTIALS` = `/etc/secrets/nats.creds` (Trỏ đúng tới file bạn vừa tạo ở trên).
5. **Đặc biệt lưu ý**: KHÔNG TẠO các biến `NATS_USERNAME` và `NATS_PASSWORD`.
6. Bấm **Create Environment Group**.

---

## 4. Deploy Backend (Render)

Hệ thống dùng tính năng **Render Blueprint** (file `render.yaml`) để tự động tạo và quản lý hạ tầng. Code sẽ tự động build từ các file `Dockerfile.prod`.

### 4.1. Link Environment Group
1. Vào Render Dashboard -> Mở từng Service (`myunivokai-gateway`, `dna`, `universe`, `nature`).
2. Vào tab **Environment** -> Mục **Linked Environment Groups**.
3. Chọn group `myunivokai-shared-env` vừa tạo để liên kết.

### 4.2. Khai báo Environment Variables cho từng Service

Mỗi Service sẽ có những biến đặc thù (các biến dùng chung như NATS đã được lo bởi Env Group). Dưới đây là danh sách bạn cần điền thủ công trên Render Dashboard cho từng service:

#### 🟢 API Gateway (`myunivokai-gateway`)
- `API_ALLOWED_ORIGINS`: `https://myunivokai.vercel.app` (Không có dấu `/` ở cuối).
- `REDIS_URL`: Chuỗi Upstash Redis của bạn.

#### 🟢 DNA Service (`myunivokai-dna`)
- `DATABASE_URL`: Trỏ tới database `myunivokai_dna` (có pooler).
- `DATABASE_DIRECT_URL`: Trỏ tới database `myunivokai_dna` (trực tiếp).
- `GEMINI_API_KEY`: API Key của Google Gemini.
- `OPENAI_API_KEY`: API Key của OpenAI.

#### 🟢 Universe Service (`myunivokai-universe`)
- `DATABASE_URL`: Trỏ tới database `myunivokai_universe` (có pooler).
- `DATABASE_DIRECT_URL`: Trỏ tới database `myunivokai_universe` (trực tiếp).
- `PUBLIC_WEB_URL`: `https://myunivokai.vercel.app/universe`

#### 🟢 Nature Service (`myunivokai-nature`)
- `DATABASE_URL`: Trỏ tới database `myunivokai_nature` (có pooler).
- `DATABASE_DIRECT_URL`: Trỏ tới database `myunivokai_nature` (trực tiếp).
- `PUBLIC_WEB_URL`: `https://myunivokai.vercel.app/nature`

---

## 5. Những Bài Học Xương Máu (Post-mortem)

Để tránh lặp lại các lỗi trong tương lai, team cần ghi nhớ các điểm sau:

1. **Lỗi `nats: Authorization Violation`**: Luôn xảy ra nếu truyền nhầm REST API Token (`nhg_...`) vào NATS Client, hoặc cấu hình sai tên biến môi trường (Ví dụ: đặt tên là `NATS_CREDENTIALS_FILE` thay vì `NATS_CREDENTIALS` như trong code yêu cầu). Hãy luôn dùng file `.creds` kết hợp với Render Secret Files.
2. **Lỗi `consumer max ack pending exceeds system limit of 25000`**: Xảy ra khi Pull Subscriptions của Go NATS Client đòi quá hạn mức miễn phí của Synadia Cloud. Lỗi này **đã được fix cứng trong code** bằng việc ép `nats.MaxAckPending(1000)` vào mọi hàm `PullSubscribe()`. Tuyệt đối không xóa dòng cấu hình này trong code.
3. **Quản lý giới hạn 750 giờ Free của Render**: Cả 4 Web Services hiện tại đều có thể ngủ đông (spin down). Gateway có cài đặt `healthCheckPath` nên Render sẽ liên tục đánh thức nó. Cần lưu ý theo dõi quỹ thời gian 750 giờ/tháng nếu dự án mở rộng quy mô.
