# AI CMO

Single-brand autonomous AI Chief Marketing Officer. Internal tool only.

## Services

- **admin** (port 3000): Next.js UI — brand overview, CMO run history, Settings
- **backend** (port 3001): NestJS — authoritative data layer, orchestration
- **brain** (port 8000): Python FastAPI — LLM-powered CMO reasoning (stateless; Ollama or Anthropic)
- **postgres** (port 5432): PostgreSQL 16
- **searxng** / **crawl4ai** / **browserless**: self-hosted research search + crawl
- **lighthouse** (internal :3010): self-hosted Lighthouse runner for website audits
- Optional profiles: whatsapp (waha), listmonk, umami, changedetection, n8n, uptime-kuma

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

## Website intelligence (M9.6)

Platform-neutral. Set the site URL and the pages to audit in the admin UI
(Website -> Settings) — they are database configuration, not env vars.

```bash
curl -X POST http://localhost:3001/website/audit                  # run an audit
curl -X POST http://localhost:3001/website/recommendations/generate
```

Lighthouse measurements are FACTS; the model only ever adds INTERPRETATION and
a proposed fix, and any recommendation it cannot ground in a supplied finding
fingerprint is discarded.

## WhatsApp (M9.6)

```bash
# Apple Silicon needs the arm image: set WAHA_IMAGE_TAG=arm in .env
docker compose --profile whatsapp up -d waha
```

Connect and scan the QR from the admin UI (WhatsApp -> Connection). Automations
seed as DISABLED and never send until the owner sets one LIVE; broadcasts
require dry run -> owner confirmation -> send.
