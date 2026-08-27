"""LLM factory / Ollama health tests — no secrets in health output."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from app.adapters import factory as factory_mod
from app.adapters.factory import llm_health, selected_provider
from app.adapters.ollama import OllamaAdapter


@pytest.fixture(autouse=True)
def _clear_llm_cache():
    factory_mod.get_llm.cache_clear()
    yield
    factory_mod.get_llm.cache_clear()


def test_selected_provider_defaults_ollama(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert selected_provider() == "ollama"


def test_selected_provider_anthropic(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    assert selected_provider() == "anthropic"


def test_invalid_provider_raises(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "nope")
    with pytest.raises(RuntimeError):
        selected_provider()


def test_ollama_not_configured_health(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    h = llm_health()
    assert h["provider"] == "ollama"
    assert h["configured"] is False
    assert h["reachable"] is False
    blob = json.dumps(h)
    assert "sk-" not in blob
    assert "api_key" not in blob.lower()


def test_ollama_unreachable(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_MODEL", "test-model")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:9")

    class Boom:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, *a, **k):
            raise factory_mod.httpx.ConnectError("refused")

    with patch("app.adapters.factory.httpx.Client", return_value=Boom()):
        h = llm_health()
    assert h["configured"] is True
    assert h["reachable"] is False
    assert h["lastError"]


def test_malformed_ollama_json_fails_honestly(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "test-model")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    adapter = OllamaAdapter()
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "message": {"content": "not-json-at-all {{"},
    }
    with patch("httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.post.return_value = mock_resp
        client_cls.return_value = client
        text, _meta = adapter.complete("sys", "user")
    with pytest.raises(json.JSONDecodeError):
        json.loads(text)


def test_anthropic_optional_not_configured(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    h = llm_health()
    assert h["configured"] is False
    assert "CLAUDE_API_KEY" in (h["lastError"] or "")
