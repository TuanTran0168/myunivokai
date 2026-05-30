# Myunivokai Architecture

The backend owns input validation, AI orchestration, persistence, rate limiting, provider switching, and public-share privacy. The frontend should only call the Myunivokai API.

World creation flow:

```txt
HTTP request -> validation -> AI provider -> DNA validation -> seed -> scene config -> store -> response
```

Variant regeneration uses saved Personality DNA and never calls AI by default.
