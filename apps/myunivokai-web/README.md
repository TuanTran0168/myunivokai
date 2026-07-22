# Myunivokai Web

The Next.js client for My Unique Ok (AI). It knows one public origin through
`NEXT_PUBLIC_GATEWAY_BASE_URL` (local default `http://localhost:8080`) and never
receives AI, NATS, Redis, database, or domain-service credentials.

Generation preserves the existing UI flow while using the asynchronous API:
the client receives `202 + jobId`, polls queued/processing status with bounded
backoff and a two-minute deadline, stores the pending job in session storage,
and resumes polling after a refresh. It loads and navigates to the world only
after the job is completed.

```powershell
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Universe and Forest rendering remain selected by the scene registry and family
route helpers; the migration does not move rendering or provider calls into the
browser.
