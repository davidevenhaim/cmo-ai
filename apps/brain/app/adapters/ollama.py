"""Ollama local LLM adapter. Preferred for Apple Silicon self-hosted runs."""

from __future__ import annotations

import os
from typing import Any

import httpx


class OllamaAdapter:
    provider_name = "ollama"

    def __init__(self) -> None:
        self.base_url = (
            os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
            .strip()
            .rstrip("/")
        )
        self.model = os.environ.get("OLLAMA_MODEL", "").strip()
        if not self.model:
            raise RuntimeError(
                "OLLAMA_MODEL is required when LLM_PROVIDER=ollama"
            )
        self.timeout = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "120"))

    @property
    def model_id(self) -> str:
        return self.model

    def complete(self, system_prompt: str, user_message: str) -> tuple[str, dict]:
        # Prefer /api/chat with format=json encouragement via system prompt;
        # callers already require JSON and Nest/Pydantic validate strictly.
        payload = {
            "model": self.model,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "options": {"temperature": 0.2},
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(f"{self.base_url}/api/chat", json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Ollama request failed: {exc}") from exc

        message = data.get("message") or {}
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("Ollama returned empty completion")

        meta: dict[str, Any] = {
            "modelId": data.get("model") or self.model,
            "provider": self.provider_name,
            "inputTokens": data.get("prompt_eval_count"),
            "outputTokens": data.get("eval_count"),
            "stopReason": data.get("done_reason"),
        }
        return content, meta
