# Git Convention — Myunivokai

## Branch naming

Format:

```txt
feat/<scope>/<kebab-case-topic>
fix/<scope>/<kebab-case-topic>
```

- `<scope>`: `fe` (frontend, apps/web) hoặc `be` (backend, apps/api).
- Branch tách từ `staging`, merge ngược về `staging` qua Pull Request.
- `main` là nhánh release, chỉ merge từ `staging`.

Ví dụ:

```txt
feat/fe/universe-scene-config
feat/fe/saved-worlds-gallery
feat/be/shared-orbit-match
fix/be/rate-limit-burst
```

## Thứ tự branch FE cho MVP (kế hoạch hiện tại)

| Thứ tự | Branch | Nội dung |
|---|---|---|
| 1 | `feat/fe/universe-scene-config` | Render đúng `WorldSceneConfig` vào canvas 3D + hover/click planet |
| 2 | `feat/fe/saved-worlds-gallery` | Trang `/gallery` + localStorage `myunivokai.savedWorldIds` |
| 3 | `feat/fe/generating-export-polish` | Màn hình generating, export PNG, polish UI theo Stitch |

## Commit message

Format:

```txt
[ACTION][SCOPE][branch-name]: Mô tả ngắn gọn bằng tiếng Anh
```

- `ACTION`: `INIT`, `ADD`, `UPDATE`, `FIX`, `REMOVE`, `REFACTOR`
- `SCOPE`: `FE`, `BE`, `DOCS`

Ví dụ:

```txt
[ADD][FE][feat/fe/universe-scene-config]: Render planets from WorldSceneConfig with hover interactions
[UPDATE][BE][feat/be/shared-orbit-match]: Add match repository and resonance score service
[FIX][FE][fix/fe/share-page-title]: Map sceneName into share page heading
```

## Pull Request

- Tiêu đề PR trùng với commit chính của branch.
- PR luôn target `staging`.
- Mỗi PR một việc, không gộp nhiều feature.
