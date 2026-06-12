# Notes — Tài liệu nội bộ của Myunivokai

Thư mục này là nơi lưu kiến thức của dự án cho cả người và AI agent.
Quy tắc: tài liệu chung để ở folder chung, tài liệu riêng FE/BE để đúng folder của nó.

## Cấu trúc

| Đường dẫn | Nội dung | Ai cần đọc |
|---|---|---|
| [coding/git-convention.md](coding/git-convention.md) | Quy ước branch, commit message, PR | Bắt buộc trước khi commit |
| [coding/coding-style.md](coding/coding-style.md) | Style code: không hardcode, không viết tắt tên biến/hàm | Bắt buộc trước khi viết code |
| [fe/source-overview.md](fe/source-overview.md) | Cơ chế hoạt động của source FE (Next.js): routes, data flow, state | Khi làm việc trong `apps/web` |
| [fe/threejs-scene-architecture.md](fe/threejs-scene-architecture.md) | Nguyên lý three.js, kiến trúc scene renderer, cách custom và mở rộng | Khi đụng vào phần 3D |
| [be/source-overview.md](be/source-overview.md) | Cơ chế hoạt động của source BE (Go API): layers, AI provider, determinism | Khi làm việc trong `apps/api` |
| [Myunivokai_Implementation_Plan.md](Myunivokai_Implementation_Plan.md) | Plan tổng thể ban đầu của dự án | Tham khảo định hướng |
| [stitch_personal_universe_3d/](stitch_personal_universe_3d/) | Mockup UI từ Stitch (7 màn hình) | Khi polish UI |

## Hướng dẫn cho AI agent

1. Đọc `coding/` trước khi viết bất kỳ dòng code hay commit nào.
2. Làm task FE thì đọc `fe/`, task BE thì đọc `be/`.
3. Khi thêm cơ chế mới đáng ghi lại, cập nhật đúng file overview tương ứng — đừng tạo file trùng nội dung.
