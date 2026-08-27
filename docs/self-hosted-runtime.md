# Self-hosted runtime (Apple Silicon M4)

## Default stack (always on)

```bash
cp .env.example .env
# set LLM_PROVIDER=ollama, OLLAMA_MODEL=..., optional credentials
ollama pull <model>
docker compose up --build
```

Services:

- admin :3000
- backend :3001
- brain :8000 → host Ollama :11434
- postgres :5432
- searxng :8080
- crawl4ai :11235
- browserless :3002

## Optional profiles (do not start unless needed)

| Profile     | Services         | Purpose                                   |
| ----------- | ---------------- | ----------------------------------------- |
| `email`     | listmonk         | Self-hosted newsletter/tx email execution |
| `analytics` | umami + umami-db | Self-hosted web analytics                 |
| `watch`     | changedetection  | Competitor URL change → research webhook  |
| `ops`       | n8n, uptime-kuma | Workflow glue + ops monitoring            |
| `full`      | all of the above | Full optional stack                       |

```bash
docker compose --profile email --profile analytics up -d
docker compose --profile ops up -d
docker compose --profile full up -d
```

## Research pipeline

```
SearXNG → Crawl4AI → Browserless fallback
  → Nest sanitize/normalize → Postgres (UNTRUSTED)
  → Ollama
```

Changedetection webhooks → `POST /webhooks/changedetection?token=...`
→ research finding only (no auto-publish).

## Email

```
Campaign → consent → frequency cap → approval
  → listmonk (or MockEmailProvider)
  → observations
```

## Browser actions

`POST /browser/actions` with Nest-validated types:

- `READ_PAGE`, `VERIFY_DRAFT` (Browserless)
- `CREATE_DRAFT` / `UPDATE_DRAFT` → UNSUPPORTED for generic sites
  (use WordPress/Postiz APIs)

LLM proposes; Nest executes. No unrestricted browser control.

## n8n role

Optional glue for cron/webhooks only. Nest remains authoritative for
business state, approvals, safety, and execution policy.

## Configuration precedence

1. Persisted Settings (Admin UI)
2. Bootstrap env (first seed only)
3. Code defaults

Secrets stay in `.env` — never in Settings, prompts, logs, or DB policy rows.

## Deferred (intentionally)

- S3/MinIO (no substantial media yet)
- Meilisearch/Typesense (Postgres sufficient)
- Complex secret vault (review growing `.env`; vault later if needed)
- Engagement bots / anti-abuse evasion (never)
