"""LLM provider factory. Explicit selection via LLM_PROVIDER."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

import httpx

from app.adapters.claude import ClaudeAdapter
from app.adapters.ollama import OllamaAdapter


def selected_provider() -> str:
    raw = os.environ.get("LLM_PROVIDER", "ollama").strip().lower()
    if raw in ("ollama", "anthropic"):
        return raw
    raise RuntimeError(
        f"Invalid LLM_PROVIDER={raw!r}; expected 'ollama' or 'anthropic'"
    )


@lru_cache(maxsize=1)
def get_llm() -> Any:
    provider = selected_provider()
    if provider == "ollama":
        return OllamaAdapter()
    return ClaudeAdapter()


def llm_health() -> dict[str, Any]:
    """Observable LLM status — never includes secrets."""
    provider = selected_provider()
    status: dict[str, Any] = {
        "provider": provider,
        "model": None,
        "configured": False,
        "reachable": False,
        "lastError": None,
    }

    try:
        if provider == "ollama":
            model = os.environ.get("OLLAMA_MODEL", "").strip()
            base = (
                os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
                .strip()
                .rstrip("/")
            )
            status["model"] = model or None
            status["configured"] = bool(model)
            if not model:
                status["lastError"] = "OLLAMA_MODEL not set"
                return status
            try:
                with httpx.Client(timeout=5.0) as client:
                    r = client.get(f"{base}/api/tags")
                    r.raise_for_status()
                    names = [
                        m.get("name")
                        for m in (r.json().get("models") or [])
                        if isinstance(m, dict)
                    ]
                    status["reachable"] = True
                    if model not in names and not any(
                        n.startswith(f"{model}:") or n == model for n in names
                    ):
                        # Model may still work if pulled under a tag alias.
                        status["lastError"] = (
                            f"Model {model!r} not listed by Ollama "
                            f"(available: {', '.join(names[:8]) or 'none'})"
                        )
            except httpx.HTTPError as exc:
                status["lastError"] = f"Ollama unreachable: {exc}"
            return status

        # anthropic
        key = os.environ.get("CLAUDE_API_KEY", "").strip()
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip()
        status["model"] = model
        status["configured"] = bool(key)
        if not key:
            status["lastError"] = "CLAUDE_API_KEY not set"
            return status
        # Do not call Anthropic on every health check — configured ≠ reachable probe.
        status["reachable"] = True
        return status
    except Exception as exc:  # noqa: BLE001 — health must never throw
        status["lastError"] = str(exc)
        return status
