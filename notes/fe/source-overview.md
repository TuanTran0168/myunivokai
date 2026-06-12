# FE Source Overview — clients/web-client

Next.js 14 App Router + TypeScript + Tailwind + React Three Fiber.
Toàn bộ trang là client component vì cần WebGL và localStorage.

## Routes

| Route | File | Vai trò |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing + form tạo universe (gộp chung). Submit → POST /worlds → redirect |
| `/worlds/[worldId]` | `src/app/worlds/[worldId]/page.tsx` | Dashboard: canvas 3D, panel planets, variants, publish/share |
| `/gallery` | `src/app/gallery/page.tsx` | Worlds đã lưu trên máy (localStorage), load song song từng world |
| `/share/worlds/[shareSlug]` | `src/app/share/worlds/[shareSlug]/page.tsx` | Trang public, chỉ dữ liệu an toàn từ share API |

## Tầng lib — nơi mọi data đi qua

- `lib/api.ts` — client gọi API duy nhất. Quan trọng nhất là các hàm `normalize*`:
  BE trả response dạng `{ world, selectedVariant, variants }` (list ở root response),
  normalize ép về type `World`/`WorldVariant` thống nhất cho UI. **Bug dễ gặp nhất
  của FE từng nằm ở đây** (đọc sai chỗ → canvas rơi về fallback). Sửa response shape
  của BE thì phải sửa normalize trước tiên.
- `lib/types.ts` — mirror đúng contract JSON của BE (`services/universe-service/internal/models/scene.go`).
  Đổi schema BE thì đổi file này cùng lúc.
- `lib/scene.ts` — helper đọc scene config an toàn (`planetsFromScene`, `paletteFromScene`,
  `backgroundColorFromScene`) + `randomFromSeed` (PRNG tất định, cấm `Math.random()` trong scene).
- `lib/savedWorlds.ts` — localStorage key `myunivokai.savedWorldIds`. Tự lưu khi
  tạo world và khi mở trang world.

## Phần 3D

Đọc [threejs-scene-architecture.md](threejs-scene-architecture.md) — có giải thích
nguyên lý three.js, kiến trúc registry và hướng dẫn thêm cảnh mới.

## State

Không dùng Redux/Zustand. Mỗi page tự quản state bằng `useState`/`useMemo`;
selection planet đồng bộ giữa canvas và panel qua props (`selectedPlanetKey` +
`onSelectPlanet`). Nếu sau này state phình ra giữa nhiều trang thì mới cân nhắc store.

## Checks bắt buộc trước khi commit

```bash
cd clients/web-client
npm run typecheck
npm run lint
npm run build
```
