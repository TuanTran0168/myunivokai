# Đề xuất — FE chỉ cần biết 1 URL gateway duy nhất

Status: **PROPOSED, chưa code.** Ghi lại vì đây là câu hỏi hợp lý owner đặt ra
khi đọc [../ops/render-deployment.md](../ops/render-deployment.md) (2026-07-18):
*"Sao lại 2 biến `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_NATURE_API_BASE_URL`?
Tôi tưởng chỉ cần 1 URL vào gateway, gateway tự forward đi tới services chứ?"*
Câu hỏi đúng về mặt kiến trúc gateway — chỉ là FE hiện tại chưa tận dụng nó.

## Hiện trạng — vì sao đang là 2 biến

Gateway **đúng là** chỉ cần 1 origin: nó tự route theo path prefix
(`/api/universe/*` → universe-service, `/api/nature/*` → nature-service — xem
[api-gateway.md](api-gateway.md)). Nhưng FE **chưa** tự tính prefix theo
`family` trong code — nó nối chuỗi thẳng từ biến môi trường:

```ts
// clients/web-client/src/lib/api.ts (hiện tại)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
const NATURE_API_BASE_URL = process.env.NEXT_PUBLIC_NATURE_API_BASE_URL ?? DEFAULT_NATURE_API_BASE_URL;

const API_BASE_URLS_BY_FAMILY: Record<WorldFamily, string> = {
  universe: API_BASE_URL,
  nature: NATURE_API_BASE_URL
};

// request() chỉ nối chuỗi, không tự suy prefix từ family:
fetch(`${API_BASE_URLS_BY_FAMILY[family]}${path}`, ...)
```

**Lý do lịch sử:** trước khi có gateway, universe-service và nature-service là
**2 host thật khác nhau** (`myunivokai.onrender.com` vs
`myunivokai-nature.onrender.com`) — lúc đó bắt buộc 2 biến. Khi gateway ra đời
(PR #68), cách làm là **giữ nguyên code FE**, chỉ đổi **giá trị** 2 biến để cả
hai cùng trỏ một gateway host, khác suffix:

```txt
NEXT_PUBLIC_API_BASE_URL        = https://<gateway>/api/universe
NEXT_PUBLIC_NATURE_API_BASE_URL = https://<gateway>/api/nature
```

Zero thay đổi code, đổi hạ tầng xong chỉ sửa Vercel env — hợp lý cho lúc đó
(gateway là thay đổi rủi ro, muốn tách biệt khỏi thay đổi FE). Nhưng hệ quả:
2 biến giờ **luôn phải cùng 1 host** — không còn lý do kiến trúc để tách, chỉ
còn là chỗ có thể gõ nhầm (lệch host giữa 2 biến mà không ai biết cho tới khi
gọi API sai).

## Đề xuất — 1 biến gateway, FE tự nối prefix

```ts
// clients/web-client/src/lib/api.ts (đề xuất)
const GATEWAY_BASE_URL = (process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL).replace(/\/$/, "");

const API_PATH_PREFIX_BY_FAMILY: Record<WorldFamily, string> = {
  universe: "/api/universe",
  nature: "/api/nature"
};

const API_BASE_URLS_BY_FAMILY: Record<WorldFamily, string> = {
  universe: `${GATEWAY_BASE_URL}${API_PATH_PREFIX_BY_FAMILY.universe}`,
  nature: `${GATEWAY_BASE_URL}${API_PATH_PREFIX_BY_FAMILY.nature}`
};
```

```txt
# .env — chỉ còn 1 biến
NEXT_PUBLIC_GATEWAY_BASE_URL=https://<gateway-host>
```

FE giờ **chỉ cần biết gateway ở đâu**; việc "family nào đi prefix nào" là
hằng số trong code (giống hệt cách gateway tự biết prefix nào forward đi
đâu) — đúng tinh thần "1 URL, gateway/registry lo phần còn lại".

## Việc cần làm nếu triển khai (chỉ liệt kê — chưa làm)

| File | Thay đổi |
| --- | --- |
| `clients/web-client/src/lib/api.ts` | Gộp `API_BASE_URL`/`NATURE_API_BASE_URL` thành `GATEWAY_BASE_URL` + `API_PATH_PREFIX_BY_FAMILY`; `backendOriginUrl()` đổi nguồn đọc |
| `clients/web-client/.env.example` | 1 biến `NEXT_PUBLIC_GATEWAY_BASE_URL` thay 2 biến cũ |
| `clients/web-client/.env.render` | Cập nhật ghi chú + giá trị production |
| `clients/web-client/docker-compose-local.yml` + root `docker-compose-local.yml` | Build arg đổi tên biến |
| `notes/ops/render-deployment.md` | Bảng Vercel env chỉ còn 1 dòng |
| `notes/vision/deployment.md` | Câu "cả 2 biến mang prefix đầy đủ" sửa lại |
| FE test liên quan `api.ts` (nếu có) | Cập nhật theo tên biến mới |

## Trade-off — vì sao chưa làm ngay

- **Được:** ít 1 biến cấu hình, không còn nguy cơ 2 biến lệch host nhau, code
  FE phản ánh đúng thực tế "1 gateway, N family".
- **Mất:** nếu tương lai một family cần đi thẳng một host khác gateway (hiếm,
  nhưng ví dụ: rollback tạm thời gọi thẳng nature-service bỏ qua gateway để
  debug), phải thêm lại override — dễ, nhưng không "free" như bây giờ (2 biến
  độc lập cho phép override từng cái ngay, không cần đổi code).
- Đây là **refactor code thật** (không phải docs), cần nhánh `feat/fe/...`
  riêng, chạy lại 4 gate FE, và test cả 2 họ scene (universe + forest) trỏ
  đúng gateway sau khi đổi biến.

## Quyết định

Chưa quyết. Ghi lại để owner duyệt khi thấy đáng làm; không chặn việc gì khác
— 2 biến hiện tại **vẫn đúng và chạy tốt**, đây thuần là dọn nợ kỹ thuật nhỏ.
