# Coding Style — Myunivokai

Áp dụng cho toàn bộ code trong repo (Go backend và TypeScript frontend).

## 1. Không hardcode

- Mọi magic number / magic string phải được đặt tên thành hằng số (constant) ở đầu file hoặc file config riêng.
- Giá trị tunable (kích thước, tốc độ, màu fallback, giới hạn) khai báo thành constant có tên rõ nghĩa.

```ts
// Sai
const radius = 1.4 + random() * 3.8;

// Đúng
const MINIMUM_ORBIT_RADIUS = 1.4;
const ORBIT_RADIUS_RANGE = 3.8;
const orbitRadius = MINIMUM_ORBIT_RADIUS + random() * ORBIT_RADIUS_RANGE;
```

## 2. Không viết tắt tên biến và hàm

- Tên biến, hàm, type phải viết đầy đủ, tường minh, tự mô tả.
- Người đọc hiểu được code mà không cần comment giải thích tên.

```ts
// Sai
const cfg = getCfg();
function calcPos(p, t) {}

// Đúng
const sceneConfig = getSceneConfig();
function calculatePlanetPosition(planet: PlanetSceneConfig, elapsedTime: number) {}
```

## 3. Tường minh hơn là ngắn gọn

- Ưu tiên cấu trúc rõ ràng, dễ đọc hơn là code "thông minh" nhưng khó hiểu.
- Mỗi hàm làm một việc, tên hàm nói đúng việc đó.
- Tránh lồng ternary nhiều tầng; dùng if/else hoặc tách hàm.

## 4. Quy ước đặt tên

| Loại | Quy ước | Ví dụ |
|---|---|---|
| Hằng số (TS) | UPPER_SNAKE_CASE | `DEFAULT_CAMERA_DISTANCE` |
| Biến / hàm (TS) | camelCase đầy đủ | `selectedPlanetKey`, `buildParticlePositions` |
| Component React | PascalCase | `PlanetDetailsPanel` |
| Hằng số / biến (Go) | theo chuẩn Go, nhưng tên đầy đủ | `defaultOrbitSpeed` |

## 5. Frontend cụ thể

- Không gọi AI từ frontend (rule trong AGENTS.md).
- Mọi giá trị scene 3D phải đọc từ `WorldSceneConfig` do backend trả về; chỉ dùng fallback constant có tên khi config thiếu.
- Type của FE phải mirror đúng JSON contract của BE (`contracts/schemas/`).
