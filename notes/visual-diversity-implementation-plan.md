# Kế hoạch triển khai "vẽ đa dạng hơn" — 5 rounds

> Bản triển khai của định hướng
> [vision/visual-diversity.md](vision/visual-diversity.md) (thang 5 bậc).
> Ghi đủ chi tiết để nếu phiên làm việc đứt giữa chừng, phiên sau (hoặc người
> khác) đọc file này là tiếp tục được đúng chỗ.
>
> **Cách làm việc đã chốt với owner (2026-07-11)**: mỗi round = 1 branch =
> 1 PR vào `staging`. Claude code + commit local + 4 gates xanh → owner tự
> push, tự check bằng mắt, tự merge → owner nói "tiếp tục" thì mới sang round
> kế. Không code gối đầu round.

## Trạng thái

| Round | Branch | Bậc | Trạng thái |
|---|---|---|---|
| R1 — Procedural gas giants | `feat/fe/procedural-gas-giants` | 3 | **ĐANG LÀM** |
| R2 — Scene diversity config (schema 1.2) | `feat/fe-be/scene-diversity-config` | 1 | Chờ owner mở lại scope BE |
| R3 — Moons + seeded rings | `feat/fe/procedural-moons-and-rings` | 3 | Chưa bắt đầu |
| R4 — Texture pool expansion | `feat/fe/texture-pool-expansion` | 2 | Chưa bắt đầu |
| R5 — Rare sky events | `feat/fe/rare-sky-events` | 4 | Chưa bắt đầu |

Thứ tự thực thi: R1 → (R2 nếu BE đã mở, không thì R3) → R3 → R4 → R5.
Bậc 5 (scene family mới) KHÔNG thuộc chuỗi này — đi theo roadmap
[vision/README.md](vision/README.md), chặn bởi duyệt D1–D5.

## R1 — Procedural gas giants (`feat/fe/procedural-gas-giants`)

Mục tiêu: một số hành tinh nhận bề mặt khí quyển dải mây SINH THEO SEED —
không world nào giống world nào — thay vì rút mãi từ pool 8 texture ảnh thật.

Cách làm (quyết định kỹ thuật):

1. **CanvasTexture equirectangular sinh CPU** (theo tiền lệ
   `shared/nebulaCloudTexture.ts`), KHÔNG viết ShaderMaterial riêng — lý do:
   texture cắm thẳng vào `meshStandardMaterial` nên toàn bộ pipeline sáng/tối
   ngày-đêm, rim/fill, fog, grade, bloom dùng lại nguyên vẹn, không phải
   tự viết lighting trong GLSL.
2. **Chống rách mép (seam)**: sample noise 3D trên mặt trụ —
   `noise(cos(longitude)·f, latitude·f_stretch, sin(longitude)·f)` — kinh độ
   0/2π tự khớp, không cần vá mép.
3. **Công thức bề mặt**: màu = ramp dải theo
   `latitude + turbulence·fbm(...)`; số dải, biên độ xoáy, độ tương phản,
   0–2 "bão" oval (kiểu Vết Đỏ Lớn) đều rút từ stream
   `randomFromSeed(seed + "-gas-giant-" + planetIndex)`.
4. **Màu từ DNA**: ramp dải sinh quanh `planet.color` (biến thiên
   lightness/saturation), không phá nhận diện màu của hành tinh.
5. **Luật gán vai**: hành tinh đủ lớn (theo size đã render) có xác suất
   seeded trở thành gas giant procedural; hành tinh nhỏ giữ texture ảnh.
   Ngưỡng + xác suất là hằng số đặt tên.
6. **Hooks vô điều kiện**: hành tinh procedural vẫn `useLoader` texture
   fallback như thường rồi bỏ qua (pattern có sẵn ở Earth maps).
7. **Tách phần pure**: hàm sinh "recipe" (tham số dải/bão từ seed) tách khỏi
   phần vẽ canvas → unit test determinism cho recipe (canvas không test được
   trong jsdom).
8. Độ phân giải texture: hằng số, khởi điểm 1024×512 (dải mây tần số thấp,
   không cần 8K); texture cache theo key seed+index để không sinh lại khi
   re-render.

Definition of done: 4 gates xanh; cùng seed → cùng hành tinh gas giant với
cùng hoa văn; world cũ đổi hình ở các hành tinh được gán vai (chấp nhận —
đây là feature thị giác FE, không phải data DB); owner duyệt bằng mắt.

## R2 — Scene diversity config, schema 1.2 (`feat/fe-be/scene-diversity-config`)

**Chặn bởi: owner xác nhận mở lại scope BE.** Làm y tiền lệ round
sky-from-database (schema 1.1, xem `notes/sky-db-and-realism-plan.md`).

1. BE models: section `belt`, `comets`, `sun` + promote `postFX` grade —
   pointer + `omitempty`.
2. BE builder: sinh từ DNA + mood profile, stream riêng (`seed+"-belt"`,
   `seed+"-comets"`, `seed+"-sun"`); bump `schemaVersion` → `1.2`; cập nhật
   JSON schema contract; regen swagger
   (lệnh trong memory: `swag init` — xem note round sky).
3. BE tests: determinism + bounds.
4. FE types + resolver (`resolveBeltConfig`…): clamp + fallback = hằng số
   hiện tại → world 1.0/1.1 render y như cũ.
5. FE renderers đọc config: `AsteroidBelt` (có/không, mật độ 300–2500, bán
   kính, màu đá, độ nghiêng), `Comet` (số lượng 0–3, cỡ đuôi), `Sun` (tint
   nhiệt độ + cường độ HDR), `PostEffects` (grade từ config thay bảng theme).
6. FE preview mirror: mở rộng `buildPreviewSkyConfig` pattern → preview khớp
   world thật (mirror-pair discipline).

DoD: gates BE (test + build) + 4 gates FE xanh; world cũ pixel-y-hệt
(fallback đúng); world mới tạo có section 1.2 trong DB.

## R3 — Moons + seeded rings (`feat/fe/procedural-moons-and-rings`)

1. Mặt trăng: 0–3 moon procedural cho hành tinh lớn — icosphere + crater
   noise (tái dùng `seededNoise3d`), group lồng trong planet anchor (pattern
   axial-tilt/spin sẵn có), stream `seed+"-moons-"+planetIndex`.
2. Moon KHÔNG ghi vào `PlanetPositionTracker` (không phải DNA object,
   không click-focus), tắt raycast.
3. Vành đai seeded cho hành tinh bất kỳ: xác suất seeded, texture vành 1D
   procedural theo palette (CanvasTexture nhỏ), dùng lại
   `buildRadialRingGeometry` (đã fix UV radial ở round visual-quality).
4. Cẩn trọng: hành tinh vai Saturn ĐÃ có ring texture ảnh — luật gán không
   được chồng ring procedural lên ring ảnh.

DoD: gates xanh; determinism; owner duyệt mắt.

## R4 — Texture pool expansion (`feat/fe/texture-pool-expansion`)

1. Tải bộ texture Solar System Scope chưa dùng (moon, ceres, eris, makemake,
   haumea…) — license CC BY 4.0, resize offline về 2K (script PowerShell
   System.Drawing như round trước), cập nhật
   `public/textures/solar-system/ATTRIBUTION.md`.
2. Thêm entry catalog → pool 8 thành 15+; seed rút không lặp.
3. Luật tint theo palette: `material.color` nhân màu — CHỈ cho hành tinh vai
   fiction, không tint Earth/hành tinh nhận diện cao.
4. Kiểm tổng payload: hiện ~27MB, trần đề xuất ~40MB trước khi bắt buộc làm
   quality tiers.

DoD: gates xanh; payload trong trần; ATTRIBUTION đủ.

## R5 — Rare sky events (`feat/fe/rare-sky-events`)

1. Stream `seed+"-rare-features"` + bảng xác suất là hằng số đặt tên
   (RARE_FEATURE_PROBABILITIES).
2. Feature đầu tiên: mưa sao băng định kỳ (~5%) — particle streak tái dùng
   `SizedStarPoints`; binary sun (~3%) — sun thứ hai nhỏ quay quanh trọng
   tâm (cẩn trọng: pointLight thứ hai + bloom).
3. **Nhãn bắt buộc**: HUD/share page hiển thị tên feature hiếm user "trúng"
   — không nhãn thì feature hiếm vô nghĩa.
4. Nếu sau này cần cross-surface tuyệt đối (BE biết world có binary sun để
   ghi vào share metadata) → promote flag vào schema, làm ở round BE kế.

DoD: gates xanh; xác suất kiểm bằng test trên 1000 seed cố định (đếm tần
suất trong khoảng cho phép); owner duyệt mắt.

## Guardrails chung (áp cho mọi round)

- Determinism: mọi biến thể từ `randomFromSeed(seed + "-stream-riêng")`;
  cấm `Math.random`/`Date.now` trong scene code.
- Stream PRNG mới cho feature mới — không làm lệch lần rút của feature cũ.
- Hằng số đặt tên cho mọi giá trị tune; không hardcode.
- Texture màu → `applyColorTextureQuality`; data map →
  `applyDataTextureQuality` (xem
  [fe/universe-render-mechanism.md](fe/universe-render-mechanism.md)).
- Scenery mới → `raycast={() => null}`.
- 4 gates FE sau mỗi cụm: typecheck, lint, vitest, build.
- Commit format `[ACTION][SCOPE][branch]: message` + trailer Co-Authored-By.
