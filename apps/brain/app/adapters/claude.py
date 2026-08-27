"""Anthropic Claude adapter. Optional — only required when LLM_PROVIDER=anthropic."""

from __future__ import annotations

import os
from typing import Any

import anthropic


class ClaudeAdapter:
    provider_name = "anthropic"

    def __init__(self) -> None:
        api_key = os.environ.get("CLAUDE_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "CLAUDE_API_KEY is required when LLM_PROVIDER=anthropic"
            )
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip()

    @property
    def model_id(self) -> str:
        return self.model

    def complete(self, system_prompt: str, user_message: str) -> tuple[str, dict]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            timeout=60.0,
        )
        content = response.content[0].text
        meta: dict[str, Any] = {
            "modelId": self.model,
            "provider": self.provider_name,
            "inputTokens": response.usage.input_tokens,
            "outputTokens": response.usage.output_tokens,
            "stopReason": response.stop_reason,
        }
        return content, meta
