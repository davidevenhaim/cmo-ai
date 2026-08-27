import json
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.schemas.measurement import WeeklyReviewRequest
from app.services.measurement_service import (
    MeasurementService,
    _build_weekly_message,
)


def make_request(**overrides) -> WeeklyReviewRequest:
    base = dict(
        brandName="Brand A",
        facts=[
            "Revenue last 7 days: 5000 USD (up 4% vs previous 7 days)",
            "Content: 3 published, 2 measured (1 outperformed, 1 inconclusive)",
            "Revenue attribution (last-touch, not incremental): 800 USD",
        ],
    )
    base.update(overrides)
    return WeeklyReviewRequest(**base)


class TestWeeklyMessage:
    def test_includes_brand_and_facts(self):
        msg = _build_weekly_message(make_request())
        assert "Brand A" in msg
        assert "Revenue last 7 days: 5000 USD" in msg
        assert "last-touch, not incremental" in msg

    def test_handles_empty_facts(self):
        msg = _build_weekly_message(make_request(facts=[]))
        assert "(no facts)" in msg

    def test_handles_missing_brand_name(self):
        msg = _build_weekly_message(make_request(brandName=None))
        assert "Unknown" in msg


class TestWeeklyRequestSchema:
    def test_rejects_too_many_facts(self):
        with pytest.raises(ValidationError):
            WeeklyReviewRequest(facts=[f"fact {i}" for i in range(81)])

    def test_defaults(self):
        req = WeeklyReviewRequest()
        assert req.brandName is None
        assert req.facts == []


class TestInterpretWeekly:
    @patch("app.services.measurement_service.get_llm")
    def test_returns_interpretation(self, mock_get_llm):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps(
                {
                    "headline": "A steady week with one clear content win.",
                    "narrative": "Revenue rose 4%. One measured piece outperformed.",
                }
            ),
            {"modelId": "test"},
        )
        mock_get_llm.return_value = mock_adapter

        service = MeasurementService()
        result = service.interpret_weekly(make_request())

        assert result.headline == "A steady week with one clear content win."
        assert "outperformed" in result.narrative

    @patch("app.services.measurement_service.get_llm")
    def test_strips_markdown_fences(self, mock_get_llm):
        mock_adapter = MagicMock()
        payload = {"headline": "h", "narrative": "n"}
        mock_adapter.complete.return_value = (
            f"```json\n{json.dumps(payload)}\n```",
            {"modelId": "test"},
        )
        mock_get_llm.return_value = mock_adapter

        service = MeasurementService()
        result = service.interpret_weekly(make_request())
        assert result.headline == "h"
        assert result.narrative == "n"

    @patch("app.services.measurement_service.get_llm")
    def test_rejects_malformed_response(self, mock_get_llm):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps({"headline": "only headline"}),
            {"modelId": "test"},
        )
        mock_get_llm.return_value = mock_adapter

        service = MeasurementService()
        with pytest.raises(ValidationError):
            service.interpret_weekly(make_request())

    @patch("app.services.measurement_service.get_llm")
    def test_non_json_response_raises(self, mock_get_llm):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = ("not json", {"modelId": "test"})
        mock_get_llm.return_value = mock_adapter

        service = MeasurementService()
        with pytest.raises(json.JSONDecodeError):
            service.interpret_weekly(make_request())

    @patch("app.services.measurement_service.get_llm")
    def test_sends_system_prompt_and_facts(self, mock_get_llm):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps({"headline": "h", "narrative": "n"}),
            {"modelId": "test"},
        )
        mock_get_llm.return_value = mock_adapter

        service = MeasurementService()
        service.interpret_weekly(make_request())

        system_prompt, user_message = mock_adapter.complete.call_args.args
        assert "correlation as causation" in system_prompt
        assert "Revenue last 7 days: 5000 USD" in user_message
