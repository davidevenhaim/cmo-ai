# AI CMO

Single-brand autonomous AI Chief Marketing Officer. Internal tool only.

## Services

- **admin** (port 3000): Next.js UI — brand overview, CMO run history, Settings
- **backend** (port 3001): NestJS — authoritative data layer, orchestration
- **brain** (port 8000): Python FastAPI — LLM-powered CMO reasoning (stateless; Ollama or Anthropic)
- **postgres** (port 5432): PostgreSQL 16
- **searxng** / **crawl4ai** / **browserless**: self-hosted research search + crawl
- Optional profiles: listmonk, umami, changedetection, n8n, uptime-kuma

## Quick start (Apple Silicon)

See [docs/self-hosted-runtime.md](docs/self-hosted-runtime.md).

```bash
cp .env.example .env # set LLM_PROVIDER=ollama, OLLAMA_MODEL=..., optional credentials
ollama pull <your-model>
docker compose up --build
# optional: docker compose --profile email --profile analytics --profile ops up -d
```

## Dev CMO trigger

POST http://localhost:3001/dev/cmo/run
