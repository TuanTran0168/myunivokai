# FE Production Refactor Plan — clients/web-client

Mục tiêu: kết thúc giai đoạn MVP. Mỗi hạng mục là **một branch + một PR riêng**,
theo thứ tự. Branch nào xong phải pass `npm run typecheck && npm run lint && npm run build`,
và từ mục 2 trở đi phải kèm unit test (vitest).

Trạng thái: đánh dấu ✅ khi PR đã merge vào `staging`.

| # | Branch | Mức độ | Trạng thái |
|---|---|---|---|
| 1 | `feat/fe/unit-testing-setup` | 🔴 nền tảng | ⬜ |
| 2 | `refactor/fe/typed-api-client` | 🔴 bắt buộc trước deploy | ⬜ |
| 3 | `refactor/fe/form-validation` | 🔴 bắt buộc trước deploy | ⬜ |
| 4 | `refactor/fe/page-decomposition` | 🟡 cấu trúc | ⬜ |
| 5 | `feat/fe/toast-and-loading-states` | 🟡 UX | ⬜ |
| 6 | `feat/fe/share-page-ssr-metadata` | 🟡 chia sẻ mạng xã hội | ⬜ |
| 7 | `feat/fe/mobile-performance` | 🟡 thiết bị yếu | ⬜ |
| 8 | `refactor/fe/cleanup-a11y` | 🟢 dọn dẹp | ⬜ |

## 1. feat/fe/unit-testing-setup

Vấn đề: FE không có một test nào. Bug "variants ở root response" từng sống sót
qua mọi check vì chỉ có typecheck/lint — unit test cho normalize đã bắt được nó.

Việc làm:

- Cài `vitest` + `@testing-library/react` + script `npm run test`.
- Viết test đầu tiên cho 2 vùng rủi ro nhất:
  - `lib/api.ts`: normalizeWorld/normalizeVariant/normalizeShare với fixture
    JSON đúng shape thật của BE (chép từ `models/responses.go`).
  - `lib/scene.ts`: `randomFromSeed` tất định, `planetsFromScene`, `paletteFromScene`.
- Cập nhật `notes/fe/source-overview.md` mục checks: thêm `npm run test`.

Acceptance: `npm run test` chạy trong CI local; coverage cho 2 file lib trên.

## 2. refactor/fe/typed-api-client

Vấn đề: `lib/api.ts` đầy `any` và chuỗi fallback `??` phòng thủ cho các shape
không tồn tại (`world_id`, `scene_config`...). Code phòng thủ kiểu này che giấu
bug thay vì làm lộ nó (bài học từ bug variants).

Việc làm:

- Định nghĩa schema zod cho từng response thật của BE
  (`CreateWorldResponse`, `WorldResponse`, `VariantResponse`, `PublicWorldResponse`)
  — đúng MỘT shape mỗi endpoint, không đoán mò snake_case.
- `request<T>()` parse qua zod: response sai shape → lỗi rõ ràng kèm field nào sai,
  thay vì âm thầm render fallback.
- Xóa toàn bộ `any` trong `lib/api.ts`; types trong `lib/types.ts` suy ra từ zod
  (`z.infer`) để không bao giờ lệch.

Acceptance: không còn `any` trong lib/; test fixture cũ pass; response thiếu field
chính → throw lỗi có tên field.

## 3. refactor/fe/form-validation

Vấn đề: form tạo universe đang **âm thầm tự điền default** khi user bỏ trống
(nickname rỗng → "Neo", goal rỗng → câu tự sinh). Không hợp triết lý tường minh,
và user không biết dữ liệu nào thật sự được gửi đi.

Việc làm:

- Cài `react-hook-form` + `zod` resolver (2 thư viện này nằm trong plan gốc).
- Schema zod mirror đúng rule validation của BE (`validation/world.go`):
  nickname 2-32, interests 3-8, traits 3-6, goal 10-220...
- Hiện lỗi từng field dưới input (đỏ + message), disable submit khi invalid.
- Xóa `ensureRange`/default ngầm; thêm input "Custom interest" hoạt động thật
  (nút Custom hiện tại chỉ là trang trí).
- Map `VALIDATION_ERROR.details` từ BE về đúng field trên form.

Acceptance: submit form trống → thấy lỗi từng field, không có request nào bắn đi;
BE trả 400 details → field tương ứng highlight.

## 4. refactor/fe/page-decomposition

Vấn đề: `app/page.tsx` 335 dòng trộn landing + form + options; trang world cũng
ôm nhiều logic. Cấu trúc feature folder trong plan gốc chưa được theo.

Việc làm:

- Tách theo plan gốc:
  - `features/create-universe/`: `CreateUniverseForm.tsx`, `formSchema.ts`, `constants.ts`
    (interestOptions, moodOptions... rời khỏi page).
  - `features/dashboard/`: `WorldHeaderPanel.tsx`, `PublishPanel.tsx`, `VariantsPanel.tsx`
    (trang world chỉ còn compose + state).
- Mỗi page.tsx ≤ ~80 dòng, chỉ làm điều phối.
- Không đổi hành vi — đây là refactor thuần, test mục 1-3 phải pass nguyên.

Acceptance: build + test pass, diff page.tsx chủ yếu là xóa.

## 5. feat/fe/toast-and-loading-states

Vấn đề: notice hiện tại là StatusMessage tĩnh không tự tắt; lỗi API hiện
trần trụi; canvas Suspense fallback={null} → màn đen khi đang tải texture.

Việc làm:

- Toast component (tự dismiss sau `TOAST_AUTO_DISMISS_MILLISECONDS`, xếp chồng,
  variant success/error) thay cho notice tĩnh ở world page.
- Suspense fallback trong canvas: spinner/skeleton thay vì null.
- Nút hành động (publish, variant, export) thống nhất trạng thái disabled + spinner.

Acceptance: tạo variant → toast tự biến mất; tải trang world chậm → thấy
skeleton chứ không phải khối đen.

## 6. feat/fe/share-page-ssr-metadata

Vấn đề: trang share là client component — share link lên Facebook/Zalo/Twitter
không có title/ảnh preview (bot không chạy JS). Đây là trang duy nhất cần SEO.

Việc làm:

- Chuyển `share/worlds/[shareSlug]/page.tsx` thành server component fetch từ API
  (canvas 3D vẫn là client component con).
- `generateMetadata()`: title = sceneName, description = shortNarrative,
  OpenGraph + Twitter card.
- (Tùy chọn, nếu còn thời gian) route `opengraph-image` sinh ảnh OG đơn giản
  từ palette + tên cảnh.

Acceptance: `curl` trang share thấy đủ og:title/og:description trong HTML thô.

## 7. feat/fe/mobile-performance

Việc làm:

- Phát hiện thiết bị yếu (deviceMemory/hardwareConcurrency) → giảm dpr,
  tắt bloom, giảm segment sphere qua một `qualityProfile` đặt tên rõ.
- Resize listener cho particle count (hiện chỉ đọc 1 lần lúc mount).
- Lazy-load texture: planet ở xa dùng màu phẳng đến khi texture sẵn sàng
  (tránh trắng màn đầu).
- Kiểm tra thật trên điện thoại, ghi kết quả vào PR.

Acceptance: Lighthouse mobile không tụt khung hình nghiêm trọng; không crash
WebGL trên thiết bị thử.

## 8. refactor/fe/cleanup-a11y

Việc làm:

- Rà `aria-label` cho mọi nút icon-only (export, copy, remove...).
- Focus trap trong GeneratingOverlay; `prefers-reduced-motion` tắt animation quay.
- Quét magic number còn sót → hằng số (theo notes/coding/coding-style.md).
- Xóa code/import chết, đồng bộ lại `notes/fe/source-overview.md` với cấu trúc mới.

Acceptance: `npm run lint` với rule jsx-a11y bật không lỗi.

## Definition of production-ready (FE)

- [ ] Có unit test cho lib (api normalize, scene helpers) chạy trong CI.
- [ ] Không còn `any` trong `src/lib/`.
- [ ] Form validate thật, không tự bịa dữ liệu cho user.
- [ ] Share link có preview tử tế trên mạng xã hội.
- [ ] Chạy mượt trên mobile tầm trung.
- [ ] Mỗi page.tsx chỉ điều phối, logic nằm trong features/.
