# BE Production Refactor Plan — apps/api

Mục tiêu: kết thúc giai đoạn MVP. Mỗi hạng mục là **một branch + một PR riêng**,
làm theo đúng thứ tự dưới đây (mục trước là nền của mục sau). Branch nào xong
phải pass `go test ./...` + `go vet ./...` và có test mới cho phần nó sửa.

Trạng thái: đánh dấu ✅ vào bảng khi PR đã merge vào `staging`.

| # | Branch | Mức độ | Trạng thái |
|---|---|---|---|
| 1 | `fix/be/request-hardening` | 🔴 bắt buộc trước deploy | ⬜ |
| 2 | `fix/be/per-ip-rate-limit` | 🔴 bắt buộc trước deploy | ⬜ |
| 3 | `fix/be/ai-failure-logging` | 🔴 bắt buộc trước deploy | ⬜ |
| 4 | `fix/be/gemini-schema-compat` | 🔴 bắt buộc trước deploy | ⬜ |
| 5 | `feat/be/repair-prompt-retry` | 🟡 chất lượng AI | ⬜ |
| 6 | `fix/be/variant-and-slug-race` | 🟡 đúng đắn dưới tải | ⬜ |
| 7 | `feat/be/db-pool-and-health` | 🟡 vận hành | ⬜ |
| 8 | `refactor/be/cleanup` | 🟢 dọn dẹp | ⬜ |

## 1. fix/be/request-hardening

Vấn đề: UUID sai định dạng đi thẳng xuống Postgres gây 500 thay vì 404;
request body không giới hạn kích thước.

Việc làm:

- Middleware hoặc helper validate `worldId`/`variantId` là UUID hợp lệ ngay tại
  handler (`internal/handlers/world_handler.go`), sai thì trả `NOT_FOUND` 404.
- Bọc `r.Body` bằng `http.MaxBytesReader` (giới hạn đặt thành hằng số
  `maximumRequestBodyBytes = 64 * 1024`) trước khi decode JSON ở `Create`.
- Decode JSON dùng `DisallowUnknownFields` để input lạ bị từ chối sớm.

Acceptance: test httptest cho UUID rác trả 404, body quá to trả 400,
field lạ trả 400.

## 2. fix/be/per-ip-rate-limit

Vấn đề: `internal/middleware/rate_limit.go` dùng một token bucket chung cho
toàn bộ API — một client spam là mọi người bị 429.

Việc làm:

- Limiter theo từng IP: `map[string]*rate.Limiter` + mutex, key lấy từ
  `X-Forwarded-For` (deploy sau reverse proxy) fallback `RemoteAddr`.
- Goroutine dọn entry không hoạt động quá `rateLimiterIdleTTL` (đặt hằng số).
- Giữ nguyên env `RATE_LIMIT_RPS`, `RATE_LIMIT_BURST` nhưng giờ là per-IP.

Acceptance: test 2 IP khác nhau không ảnh hưởng lẫn nhau; 1 IP vượt burst bị 429.

## 3. fix/be/ai-failure-logging

Vấn đề: khi cả 2 provider fail, attempts bị vứt — bảng `ai_generations` trống,
không debug được. Token usage cũng không được lưu (`usage_json` luôn null).

Việc làm:

- Thêm `Store.SaveAIGenerationLogs(ctx, logs)` (cả memory + postgres store).
- `WorldService.CreateWorld`: nhánh lỗi orchestrator vẫn lưu `result.Attempts`
  trước khi return error.
- `AttemptLog` thêm field `Usage`, orchestrator copy `resp.Usage` vào,
  `buildLogs` marshal vào `usage_json`.

Acceptance: test mock provider fail toàn bộ → log "failed" vẫn được lưu;
test success → usage_json có dữ liệu.

## 4. fix/be/gemini-schema-compat

Vấn đề: Gemini `responseSchema` chỉ nhận subset kiểu OpenAPI. Schema hiện tại
(từ `validation.PersonalityDNASchema()`) chứa key Gemini không hỗ trợ
(`additionalProperties`...) — nguy cơ 400 với key thật. Mới chỉ test bằng mock.

Việc làm:

- Hàm `sanitizeSchemaForGemini(schema)` private trong `providers/rest.go`:
  loại các key ngoài tập Gemini hỗ trợ (`type, format, description, enum,
  properties, required, items, nullable`), đệ quy.
- Smoke test thủ công với `GEMINI_API_KEY` thật (ghi kết quả vào PR description).
- Kiểm tra tương tự payload OpenAI (structured outputs yêu cầu
  `additionalProperties: false` — ngược với Gemini, nên sanitize phải tách riêng từng provider).

Acceptance: unit test sanitize; smoke test thật thành công với cả 2 provider.

## 5. feat/be/repair-prompt-retry

Vấn đề: plan gốc (mục 13) yêu cầu khi JSON sai schema thì retry 1 lần cùng
provider bằng repair prompt rồi mới fallback — hiện chưa có.

Việc làm:

- `prompts/world_dna_v1.go`: thêm `WorldDNARepairPrompt(previousError)`.
- `Orchestrator.tryProvider`: nếu validate fail → gọi lại provider 1 lần với
  repair prompt nối vào user prompt; vẫn log attempt riêng.
- Số lần retry đọc từ env `AI_MAX_RETRIES` (đang khai báo nhưng chưa dùng).

Acceptance: test provider trả JSON hỏng lần 1, đúng lần 2 → thành công,
2 attempts được log, không gọi fallback.

## 6. fix/be/variant-and-slug-race

Vấn đề: (a) `RegenerateVariant` tính `variant_no = len(variants)+1` ở app —
2 request song song trùng số → vi phạm UNIQUE → 500. (b) Slug publish =
nickname + 6 ký tự UUID, trùng là 500; env `SHARE_SLUG_LENGTH` chưa dùng.

Việc làm:

- INSERT variant tính số trong SQL:
  `(SELECT COALESCE(MAX(variant_no),0)+1 FROM world_variants WHERE world_id=$1)`
  và retry một lần nếu vẫn đụng UNIQUE.
- Slug: suffix random từ `seed` package, độ dài đọc từ `SHARE_SLUG_LENGTH`,
  retry với suffix mới khi đụng UNIQUE (tối đa `maximumSlugAttempts`).

Acceptance: test song song 2 goroutine tạo variant không lỗi; test slug đụng độ
được retry.

## 7. feat/be/db-pool-and-health

Việc làm:

- `db/pool.go`: cấu hình tường minh qua env có default —
  `DATABASE_MAX_CONNS`, `DATABASE_MIN_CONNS`, `DATABASE_MAX_CONN_LIFETIME`,
  `DATABASE_MAX_CONN_IDLE_TIME` (Neon khuyến nghị lifetime ngắn).
- Tách liveness/readiness: `GET /healthz` (process sống) và
  `GET /readyz` (ping DB, kiểm tra provider config) cho platform deploy.
- `http.Server` bổ sung `ReadTimeout`, `IdleTimeout` (WriteTimeout phải lớn hơn
  `AI_TIMEOUT_SECONDS`).

Acceptance: readyz trả 503 khi DB không ping được (test với memory store trả 200).

## 8. refactor/be/cleanup

Việc làm (gom các món nhỏ, vẫn 1 PR riêng):

- Xóa `NewID()` không dùng trong `world_service.go`.
- `getWorldByQuery`/`getVariants`: không nuốt lỗi `json.Unmarshal` — trả error.
- `SelectVariant`: trả variant bằng RETURNING trong UPDATE, bỏ `GetWorld` thừa
  sau commit (tiết kiệm 3 query).
- Swagger UI chỉ mount khi `APP_ENV != production` (hoặc sau env flag riêng).
- Rà soát toàn bộ magic number → hằng số đặt tên (theo notes/coding/coding-style.md).

Acceptance: `go test ./...` + `go vet ./...` sạch, hành vi API không đổi
(trừ swagger production).

## Definition of production-ready (BE)

- [ ] Mọi input không hợp lệ trả 4xx có code rõ ràng, không bao giờ 500.
- [ ] Rate limit per-IP hoạt động sau reverse proxy.
- [ ] Mọi attempt AI (thành công lẫn thất bại) đều nằm trong `ai_generations` kèm usage.
- [ ] Đã smoke test Gemini + OpenAI bằng key thật ít nhất một lần.
- [ ] Migration chạy sạch trên Neon bằng `DATABASE_DIRECT_URL`.
- [ ] Không còn dead code, không magic number, không lỗi bị nuốt.
