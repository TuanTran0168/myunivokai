# Three.js trong Myunivokai — Nguyên lý và kiến trúc scene renderer

Tài liệu này giải thích three.js hoạt động thế nào, repo đang dùng nó ra sao,
và cách custom/mở rộng (thêm cảnh núi, thành phố... trong tương lai).

## 1. Nguyên lý cơ bản của three.js

Three.js là thư viện dựng hình 3D chạy trên WebGL. Mọi thứ xoay quanh 4 khái niệm:

### Scene graph (cây cảnh)

Một cảnh 3D là một cái cây. Node cha xoay/di chuyển thì toàn bộ node con đi theo.

```txt
Scene
├── Sun (mesh + point light)
├── Group (nghiêng quỹ đạo)        ← xoay group này = nghiêng cả quỹ đạo
│   ├── OrbitPath (vòng tròn mờ)
│   └── Group (neo planet)          ← đổi position mỗi frame = planet bay quanh
│       ├── Group (nghiêng trục)    ← rotation.z = axial tilt
│       │   ├── Mesh planet         ← rotation.y tăng dần = tự xoay
│       │   └── Mesh vành đai
│       └── Html label
└── Points (ngôi sao nền)
```

Đây chính là lý do code trong `solar-system/` lồng nhiều `<group>`: mỗi tầng
group đảm nhận đúng một phép biến đổi, tách bạch quỹ đạo / trục nghiêng / tự xoay.

### Mesh = Geometry + Material

- **Geometry**: hình khối (đỉnh, mặt). `sphereGeometry`, `ringGeometry`...
- **Material**: bề mặt phản ứng với ánh sáng thế nào.
  - `meshStandardMaterial`: có ánh sáng thật (planet — mặt hướng về mặt trời sáng, mặt kia tối).
  - `meshBasicMaterial`: tự sáng, bỏ qua ánh sáng (mặt trời, orbit ring, skybox).
- **Texture**: ảnh dán lên bề mặt theo tọa độ UV. Sphere của three.js có sẵn UV
  dạng bản đồ thế giới, nên ảnh equirectangular (như texture NASA) dán lên là thành hành tinh.

### Render loop

three.js vẽ lại ~60 lần/giây. Mỗi frame, code được phép thay đổi position/rotation
trước khi vẽ — animation chính là vậy. Trong React Three Fiber (R3F), hook
`useFrame((state, delta) => {...})` chạy mỗi frame:

```tsx
useFrame(({ clock }) => {
  const orbitAngle = orbitPhase + clock.elapsedTime * orbitSpeed;
  orbitAnchor.position.set(Math.cos(orbitAngle) * orbitRadius, 0, Math.sin(orbitAngle) * orbitRadius);
});
```

Quy tắc quan trọng: **không setState trong useFrame** (sẽ re-render React 60fps).
Thay đổi trực tiếp qua `ref` như trên.

### Camera, ánh sáng, tương tác

- `PerspectiveCamera(fov, aspect, near, far)` — mắt người xem. Repo đọc `distance`/`fov` từ config BE.
- Ánh sáng: `pointLight` đặt tại mặt trời chiếu ra mọi hướng (planet có ngày/đêm),
  `ambientLight` yếu để mặt tối không đen kịt.
- Tương tác chuột: three.js dùng **raycasting** — bắn tia từ camera qua vị trí con
  trỏ, xem trúng mesh nào. R3F gói sẵn thành `onClick` / `onPointerOver` trên mesh.

### React Three Fiber (R3F)

R3F biến scene graph thành JSX: `<mesh>`, `<group>`, `<pointLight>` là các node.
React quản lý cây, three.js quản lý vẽ. Kèm theo:

- `useLoader(TextureLoader, url)` — tải texture, tự suspend → bọc `<Suspense>`.
- `@react-three/drei` — đồ dùng sẵn: `OrbitControls` (xoay/zoom chuột), `Html` (DOM neo theo vị trí 3D).
- `@react-three/postprocessing` — hiệu ứng hậu kỳ; repo dùng `Bloom` (chỗ sáng lóa ra — mặt trời rực).

## 2. Kiến trúc scene renderer của repo

Nguyên tắc: **một cảnh = một renderer**, cắm vào qua registry. Universe chỉ là
renderer đầu tiên; sau này muốn vẽ núi hay thành phố thì viết renderer mới,
không sửa cái cũ.

```txt
clients/web-client/src/
├── components/UniverseCanvas.tsx          ← shell: Canvas + camera + bloom + overlay hover
└── features/scene-renderers/
    ├── types.ts                           ← SceneRendererProps: hợp đồng mọi renderer phải theo
    ├── registry.ts                        ← theme (string từ BE) → renderer component
    ├── planetIdentity.ts                  ← sinh key định danh object chọn được
    ├── shared/                            ← cảnh nào cũng dùng được
    │   ├── CameraRig.tsx                  ← OrbitControls + camera bay đến object được chọn
    │   ├── PlanetPositionTracker.ts       ← Map<key, Vector3>: renderer ghi vị trí, CameraRig đọc
    │   ├── StarParticleField.tsx          ← sao nền bằng BufferGeometry + Points
    │   └── PostEffects.tsx                ← Bloom, cường độ đọc từ config.postFX
    ├── solar-system/                      ← renderer hệ mặt trời
    │   ├── SolarSystemRenderer.tsx        ← ghép Sun + planets + orbit + skybox
    │   ├── Sun.tsx                        ← texture mặt trời + glow + pointLight (nguồn sáng duy nhất)
    │   ├── SolarPlanet.tsx                ← texture bề mặt, trục nghiêng, tự xoay, vành đai, label
    │   ├── OrbitPath.tsx                  ← vòng quỹ đạo mờ
    │   ├── Skybox.tsx                     ← sphere lộn mặt trong, dán texture dải ngân hà
    │   └── planetTextureCatalog.ts        ← danh mục texture + độ nghiêng trục từng kiểu planet
    └── fallback/FallbackUniverseRenderer.tsx ← cảnh trừu tượng khi chưa có config (landing preview)
```

### Data flow từ backend xuống pixel

```txt
BE trả WorldSceneConfig (JSON)
  → lib/api.ts normalize về types trong lib/types.ts
  → lib/scene.ts: helper đọc palette/planets/background an toàn
  → UniverseCanvas: resolveSceneRenderer(config.theme) chọn renderer
  → SolarSystemRenderer đọc config.planets (size, orbitRadius, orbitSpeed, phase, color, energy)
  → từng SolarPlanet tự animate trong useFrame
```

Backend quyết định **dữ liệu** (bao nhiêu planet, quỹ đạo, tốc độ — sinh từ
Personality DNA + seed). Frontend quyết định **cách thể hiện** (texture, ánh sáng, hiệu ứng).

### Tính tất định (determinism)

Cùng một seed phải vẽ ra đúng một cảnh. Mọi giá trị "ngẫu nhiên" phía FE
(vị trí sao nền, độ nghiêng quỹ đạo) đều sinh từ `randomFromSeed(seed)` trong
`lib/scene.ts` (xorshift PRNG) — không bao giờ dùng `Math.random()` trong scene.

### Camera focus (giống NASA Eyes)

Click một planet → `CameraRig` lerp `OrbitControls.target` về vị trí planet đó
mỗi frame (planet đang bay, camera bám theo). Click ra ngoài → lerp về tâm.
Cầu nối là `PlanetPositionTracker`: mỗi planet ghi world position của nó vào
một `Map` mỗi frame, CameraRig chỉ việc đọc. Renderer tương lai (thành phố...)
ghi vị trí tòa nhà vào đúng Map này là camera focus hoạt động ngay, không sửa CameraRig.

## 3. Cách custom

### Chỉnh cảm giác cảnh hiện tại

Mọi giá trị tinh chỉnh là hằng số đặt tên ở đầu file (theo coding style của repo):

- Mặt trời to/nhỏ, sáng/tối: `SUN_SCALE_MULTIPLIER`, `SUN_LIGHT_INTENSITY` trong `Sun.tsx`
- Độ rực bloom: `BLOOM_LUMINANCE_THRESHOLD` trong `PostEffects.tsx` (giảm = nhiều thứ lóa hơn), `bloomIntensity` do BE cấp
- Planet to/nhỏ so với config: `PLANET_SIZE_MULTIPLIER` trong `SolarPlanet.tsx`
- Độ nghiêng quỹ đạo: `MAXIMUM_ORBIT_INCLINATION_RADIANS` trong `SolarSystemRenderer.tsx`
- Mật độ sao nền: BE cấp qua `config.particles`, fallback trong `StarParticleField.tsx`

### Thay/thêm texture planet

Thêm file vào `clients/web-client/public/textures/solar-system/` rồi thêm entry vào
`planetTextureCatalog.ts` (kèm `axialTiltRadians`, `ringTextureUrl` nếu có vành đai).
Texture lấy từ Solar System Scope (CC BY 4.0) — giữ ghi nguồn trong `ATTRIBUTION.md`.

### Thêm một loại cảnh mới (núi, thành phố, đồng quê...)

1. Tạo folder `features/scene-renderers/<tên-cảnh>/`.
2. Viết component chính nhận `SceneRendererProps` (xem `types.ts`) — tự do vẽ
   bằng three.js: terrain bằng `PlaneGeometry` + displacement, nhà cửa bằng
   `InstancedMesh`, trời bằng shader... không giới hạn.
3. Object nào muốn click-focus được: ghi vị trí vào `PlanetPositionTracker` và
   gọi `onSelectPlanet`/`onHoverPlanet` (hợp đồng dùng chung, tên giữ nguyên).
4. Đăng ký 1 dòng trong `registry.ts`: `"mountain-valley": MountainValleyRenderer`.
5. BE chỉ cần cho phép theme mới trong enum — không đổi schema.

Button switch cảnh sau này = đổi giá trị theme gọi `resolveSceneRenderer()`. Không đụng renderer cũ.

### Hiệu năng

- `dpr={[1, 1.8]}` trên Canvas chặn render quá dày trên màn retina.
- Particle count mobile thấp hơn desktop (BE cấp 2 số, FE tự chọn theo viewport).
- Texture 2k là đủ; muốn nhẹ hơn nữa thì convert sang `.webp` hoặc dùng bản 1k.
- Nhiều object lặp lại (asteroid, nhà cửa) → dùng `InstancedMesh`, 1 draw call cho cả nghìn object.
