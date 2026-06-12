# CI & Quality Gates (chung FE + BE)

Hạng mục độc lập, branch riêng: `feat/ci/github-actions`.
Nên merge **trước** khi bắt đầu chuỗi refactor BE/FE — để mọi PR refactor
đều bị gác cổng tự động, không phụ thuộc ai nhớ chạy check bằng tay.

## Việc làm

`.github/workflows/ci.yml` chạy trên mọi PR vào `staging` và `main`:

```txt
job backend:   cd services/universe-service  → go vet ./... → go test ./...
job frontend:  cd clients/web-client  → npm ci → typecheck → lint → test → build
```

- Hai job chạy song song, dùng cache (actions/setup-go, actions/setup-node).
- Path filter: PR chỉ đổi clients/web-client thì khỏi chạy job backend và ngược lại;
  đổi contracts/ hoặc notes/coding/ thì chạy cả hai.
- Bật branch protection cho `staging` + `main`: bắt buộc CI xanh mới merge được.

## Acceptance

- PR cố tình chứa lỗi typecheck bị CI chặn.
- PR chỉ sửa docs không tốn thời gian chạy test app.
