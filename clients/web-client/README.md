# Myunivokai Web

Next.js frontend for the Myunivokai MVP.

```bash
npm install
npm run dev
```

The app reads one gateway origin from `NEXT_PUBLIC_GATEWAY_BASE_URL` and
defaults to `http://localhost:8082`. It derives `/api/universe` and
`/api/nature` from the selected world family; direct service URLs are not
frontend configuration.

For the complete local platform, run from the repository root:

```bash
docker compose -f docker-compose-local.yml up --build
```

The production image uses Next.js standalone output and runs as a non-root
user. `render.yaml` deploys this image as `myunivokai-web` and supplies the
same single gateway-origin variable at build time.
