import os
import json
import anthropic
from typing import Any


class ClaudeAdapter:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=os.environ["CLAUDE_API_KEY"])
        self.model = "claude-sonnet-4-6"

    def complete(self, system_prompt: str, user_message: str) -> tuple[str, dict]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
            timeout=60.0,
        )
        content = response.content[0].text
        meta = {
            "modelId": self.model,
            "inputTokens": response.usage.input_tokens,
            "outputTokens": response.usage.output_tokens,
            "stopReason": response.stop_reason,
        }
        return content, meta
