# Định hướng vẽ đa dạng hơn — từ 1 look chung đến mỗi world một cá tính

> Status: định hướng (07/2026), viết sau khi hoàn thành round
> `feat/fe/universe-visual-quality`. Trả lời câu hỏi: **làm sao để các world
> khác nhau TRÔNG khác nhau nhiều hơn**, và mở rộng dần sang các scene family
> khác theo vision. Cơ chế render nền tảng xem
> [../fe/universe-render-mechanism.md](../fe/universe-render-mechanism.md);
> kiến trúc đa scene xem [README.md](README.md).

## Chẩn đoán hiện trạng: cái gì đã đa dạng, cái gì còn đồng phục

Đã đa dạng theo seed/DNA/theme:

| Trục | Nguồn |
|---|---|
| Số hành tinh, size, orbit, tốc độ, màu, energy | BE builder từ DNA + seed |
| Palette, mood background, particles | BE (mood profile) |
| Hình dải Milky Way, Great Rift, chòm sao | BE section `sky` (schema 1.1) |
| Độ nghiêng quỹ đạo (phẳng ↔ hỗn loạn) | FE theo theme |
| Grade màu điện ảnh | FE `THEME_SCENE_GRADES` theo theme |
| Vệ tinh NASA nào, Bennu nằm đâu, hình dạng đá vành đai | FE seeded |

Còn "đồng phục" — mọi world đều giống nhau ở:

1. **Cùng 1 Mặt Trời** (texture, size, màu lửa như nhau).
2. **Cùng pool 8 texture hành tinh thật** — world 8 hành tinh dùng đủ bộ,
   nhìn nhiều world là thấy lặp.
3. **Cùng 1 ảnh skybox Milky Way** phía sau (dải procedural có khác nhưng nền
   ảnh là một).
4. **Vành đai + sao chổi luôn tồn tại, luôn cùng mật độ/màu đá**.
5. **Không có mặt trăng, không vành đai cho hành tinh ngoài Saturn-role**.

Đa dạng hoá = tấn công dần danh sách này, theo thang chi phí bên dưới.

## Nguyên tắc: thang đa dạng 5 bậc (rẻ → đắt)

Quy tắc chọn việc: **luôn làm cạn bậc rẻ trước khi leo bậc đắt**, và mọi bậc
đều phải giữ 3 bất biến của vision (DNA theme-agnostic, determinism theo
seed, mirror-pair BE↔FE cho giá trị lưu DB).

### Bậc 1 — Vặn knob từ dữ liệu (0 asset mới, BE mirror)

Biến những thứ FE đang hardcode thành **tham số trong scene config**, theo
đúng tiền lệ section `sky` 1.1 (BE builder + FE fallback + schemaVersion
bump):

- `belt`: có/không, mật độ (thưa 300 ↔ dày 2500), bán kính, màu đá theo
  palette, độ dẹt — world "tĩnh lặng" không vành đai, world "hỗn loạn" vành
  đai dày nghiêng mạnh.
- `comets`: số lượng 0–3, cỡ đuôi, chu kỳ.
- `spacecraft`: cho DNA quyết vai (telescope cho archetype chiêm nghiệm,
  Voyager cho archetype phiêu lưu) thay vì thuần seed.
- `sun`: scale màu nhiệt độ (đỏ lạnh ↔ trắng xanh) + cường độ — chi phí gần
  0 vì chỉ là tint + HDR multiplier.
- Vị trí đưa vào: `schemaVersion 1.2` cùng đợt promote `postFX` grade (đã
  ghi trong `notes/3d-next-steps-proposal.md` đợt 1 mục 8).

### Bậc 2 — Nở catalog (asset mới, cơ chế cũ)

Cơ chế catalog + pipeline nén đã dựng xong, thêm entry là chạy:

- **Texture hành tinh**: thêm bộ "exoplanet" (moon, ceres, eris, makemake,
  haumea của Solar System Scope còn chưa dùng; texture fictional CC0) →
  pool 8 thành pool 15–20, seed rút không lặp.
- **Tint theo palette**: cùng 1 texture nhân màu palette (`material.color`)
  → nhân đôi đa dạng cảm nhận với 0 byte thêm. Cần luật tint nhẹ để không
  phá tính "thật" (chỉ tint hành tinh vai fiction, không tint Earth).
- **GLB**: thêm spacecraft (ISS, Juno, New Horizons đều có trong NASA repo),
  thêm 2–3 asteroid radar-shape (Itokawa, Eros) làm hero rock luân phiên.
- Ràng buộc: ngân sách payload — mỗi đợt thêm phải cân đối lại tổng
  (hiện ~27MB; trần đề xuất trước khi bắt buộc làm quality tiers: ~40MB).

### Bậc 3 — Procedural surfaces (0 payload, đa dạng vô hạn)

Trần của bậc 2 là "pool hữu hạn". Vượt trần bằng shader — đã có sẵn nền
`seededNoise3d` + kinh nghiệm fBm domain-warp từ nebula atlas:

- **Gas giant procedural**: shader dải mây fBm cuộn theo vĩ độ, màu từ
  palette, seed điều khiển số dải/độ xoáy/bão — mỗi world một hành tinh khí
  KHÔNG world nào giống. Đây là món đáng làm nhất bậc này.
- **Mặt trăng**: 0–3 moon nhỏ procedural (icosphere + crater noise) quay
  quanh hành tinh lớn — pattern `PlanetPositionTracker` + group lồng đã có.
- **Vành đai seeded cho hành tinh bất kỳ**: `buildRadialRingGeometry` đã có,
  sinh texture vành 1D procedural theo palette là xong.
- **Binary sun** cho DNA energy cực cao — hai sun quay quanh trọng tâm,
  hiếm gặp (xem bậc 4).

### Bậc 4 — "Xổ số vũ trụ": feature hiếm theo seed

Tăng giá trị sưu tầm/chia sẻ: một số feature chỉ xuất hiện với xác suất thấp,
tất định theo seed (ai xem cùng world thấy cùng thứ):

- ~5%: sao chổi đôi / mưa sao băng định kỳ.
- ~3%: binary sun, hành tinh lang thang ngoài rìa.
- ~1%: supernova remnant ở góc trời (sprite nebula ridged phóng to + tint).
- Quy tắc: rút từ stream riêng (`seed + "-rare-features"`), ngưỡng xác suất
  là hằng số đặt tên, và **hiển thị tên feature hiếm trong HUD/share page**
  để user biết mình "trúng" — không có nhãn thì feature hiếm vô nghĩa.
- Đây là ứng viên tốt cho marketing loop: "regenerate variant để săn
  binary sun".

### Bậc 5 — Scene family thứ hai (bước nhảy lớn nhất)

Đa dạng thật sự không nằm trong solar-system mà ở **medium khác cho cùng một
DNA** — city/nature/room theo đúng [README.md](README.md). Điểm mấu chốt cho
người thực hiện sau này: **toàn bộ pipeline model của round visual-quality là
scene-agnostic** và tái dùng nguyên vẹn:

| Đã có (solar-system) | Dùng lại cho family mới |
|---|---|
| Catalog + `targetSize` + Box3 normalize | Kit nội thất/cây/nhà CC0 (KayKit, Kenney, Quaternius — license đã verify trong `notes/3d-next-steps-proposal.md`) |
| meshopt + webp pipeline, no-CDN | y hệt, `--texture-size 512` cho kit flat-color |
| `InstancedMesh` + noise displacement | rừng cây, đá núi, toà nhà |
| `PlanetPositionTracker` + CameraRig | click-focus đồ vật/toà nhà, 0 sửa CameraRig |
| Grade theo theme + rig đèn + IBL Lightformer | preset ánh sáng phòng/thành phố |
| Stream PRNG riêng + mirror-pair | composer mới ở BE theo registry Phase 1 |

Trigger giữ nguyên như vision: **không tách service trước khi family thứ 2
tồn tại trong code** — family mới bắt đầu là 1 renderer mới + 1 composer mới
trong monolith.

## Guardrails — mọi bậc đều phải giữ

1. **Determinism tuyệt đối**: mọi biến thể từ `randomFromSeed` stream riêng;
   không `Math.random`, không `Date.now` trong scene code.
2. **DNA không chứa số visual**: AI chỉ sinh ngữ nghĩa; composer (BE) đổi
   ngữ nghĩa → số; FE đổi số → pixel.
3. **Mirror-pair**: giá trị nào lưu DB thì BE builder và FE preview builder
   phải sinh giống nhau, kèm fallback cho world cũ (tiền lệ sky 1.1).
4. **Ngân sách payload**: asset mới phải qua nén + cập nhật ATTRIBUTION;
   vượt ~40MB tổng thì bắt buộc làm quality tiers trước khi thêm tiếp.
5. **License**: chỉ CC0 / public domain / CC BY (ghi công); tự host 100%.
6. **Feature mới không đổi world cũ**: field mới optional + omitempty,
   stream PRNG mới, schemaVersion bump có chủ đích.

## Thứ tự đề xuất

1. **Bậc 1 + promote postFX** gộp 1 round schema 1.2 (BE quay lại scope khi
   user cho phép) — rẻ nhất, mở khoá "world tĩnh lặng khác world hỗn loạn".
2. **Bậc 3 gas giant + moons** — FE-only, 0 payload, ăn ngay vào cảm giác
   "hành tinh của tôi không giống của bạn".
3. **Bậc 2 texture pool + tint** — khi cần thêm chiều rộng.
4. **Bậc 4 rare features** — khi có share page metrics để đo hiệu ứng.
5. **Bậc 5 family mới** — theo roadmap vision, quyết định D1–D5 duyệt xong.
