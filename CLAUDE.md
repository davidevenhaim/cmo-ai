# AI CMO

Single-brand autonomous AI Chief Marketing Officer. Internal tool only.

## Services

- **admin** (port 3000): Next.js UI — brand overview, CMO run history
- **backend** (port 3001): NestJS — authoritative data layer, orchestration
- **brain** (port 8000): Python FastAPI — Claude-powered CMO reasoning (stateless)
- **postgres** (port 5432): PostgreSQL 16

## Quick start

cp .env.example .env # fill in CLAUDE_API_KEY
docker compose up

## Dev CMO trigger

POST http://localhost:3001/dev/cmo/run
