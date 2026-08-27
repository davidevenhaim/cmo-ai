"""Shared LLM completion interface. Providers must implement this contract."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class LlmProvider(Protocol):
    """Provider-neutral completion. Nest validates all structured outputs."""

    @property
    def provider_name(self) -> str: ...

    @property
    def model_id(self) -> str: ...

    def complete(
        self, system_prompt: str, user_message: str
    ) -> tuple[str, dict]:
        """Return (raw_text, meta). meta must include modelId; may include tokens."""
        ...
