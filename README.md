# AI CMO

Self-hosted AI Chief Marketing Officer. See [docs/self-hosted-runtime.md](docs/self-hosted-runtime.md) for M4 / Docker / Ollama setup.

```bash
brew install ollama && brew services start ollama
cp .env.example .env      # set OLLAMA_MODEL
ollama pull qwen3:30b-a3b
docker compose up --build
```

admin :3000 · backend :3001 · brain :8000
