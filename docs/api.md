# API

All routes are served under `/api/v1`.

- `GET /healthz`
- `POST /worlds`
- `GET /worlds/{worldId}`
- `POST /worlds/{worldId}/variants`
- `POST /worlds/{worldId}/variants/{variantId}/select`
- `POST /worlds/{worldId}/publish`
- `GET /share/worlds/{shareSlug}`

Errors use:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Please check the highlighted fields.", "details": [], "requestId": "..." } }
```
