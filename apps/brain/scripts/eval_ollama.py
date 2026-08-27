#!/usr/bin/env python3
"""Lightweight Ollama model evaluation harness (M9.5).

Measures schema-valid rates and latency for representative brain tasks.
Does NOT invent a universal quality score.

Usage (from apps/brain, with Ollama running):

  LLM_PROVIDER=ollama OLLAMA_MODEL=<model> python scripts/eval_ollama.py
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app.adapters.factory import get_llm, selected_provider  # noqa: E402


@dataclass
class TaskResult:
    task: str
    model: str
    provider: str
    ok: bool
    schema_valid: bool
    latency_ms: float
    output_chars: int
    error: str | None


def _time_call(fn: Callable[[], Any]) -> tuple[Any | None, float, str | None]:
    start = time.perf_counter()
    try:
        out = fn()
        return out, (time.perf_counter() - start) * 1000, None
    except Exception as exc:  # noqa: BLE001
        return None, (time.perf_counter() - start) * 1000, str(exc)


def _complete_json(llm: Any, system: str, user: str) -> dict:
    text, _ = llm.complete(system, user)
    return json.loads(text)


def main() -> int:
    provider = selected_provider()
    llm = get_llm()
    model = getattr(llm, "model_id", None) or os.environ.get("OLLAMA_MODEL", "?")

    prompts = [
        (
            "cmo_structured_decision",
            "Return JSON only for a CMO decision.",
            '{"brand":"Eval","actions":[]}',
        ),
        (
            "operator_intent",
            "Classify operator intent as JSON with intent and confidence.",
            "show me abandoned checkouts",
        ),
        (
            "operator_prioritization",
            "Prioritize actions as JSON with orderedIds.",
            '[{"id":"a","urgency":0.2},{"id":"b","urgency":0.9}]',
        ),
        (
            "content_generation",
            "Generate content draft JSON with title and body.",
            "Short skincare email about barrier repair.",
        ),
        (
            "content_critic",
            "Critique content as JSON with approved and issues.",
            '{"title":"Glow","body":"Miracle overnight!"}',
        ),
        (
            "weekly_interpretation",
            "Weekly interpretation JSON with summary and insights.",
            '{"revenue":1000,"orders":20}',
        ),
    ]

    results: list[TaskResult] = []
    for name, system, user in prompts:
        out, ms, err = _time_call(lambda s=system, u=user: _complete_json(llm, s, u))
        schema_ok = isinstance(out, dict)
        chars = len(json.dumps(out)) if out is not None else 0
        results.append(
            TaskResult(
                task=name,
                model=str(model),
                provider=provider,
                ok=err is None and schema_ok,
                schema_valid=schema_ok,
                latency_ms=round(ms, 1),
                output_chars=chars,
                error=err,
            )
        )

    report = {
        "provider": provider,
        "model": model,
        "schemaValidRate": (
            sum(1 for r in results if r.schema_valid) / len(results)
            if results
            else 0
        ),
        "taskSuccessRate": (
            sum(1 for r in results if r.ok) / len(results) if results else 0
        ),
        "latencyMs": {
            "mean": round(statistics.mean(r.latency_ms for r in results), 1),
            "p50": round(statistics.median(r.latency_ms for r in results), 1),
            "max": round(max(r.latency_ms for r in results), 1),
        },
        "tasks": [asdict(r) for r in results],
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
