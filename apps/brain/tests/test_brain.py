import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

from app.schemas.decisions import (
    CmoRunResult,
    CreateContentDecision,
    NoActionDecision,
    DecisionType,
)
from app.schemas.brand import BrandContext, Brand, BrandFact, BrandGuideline, Product
from app.services.cmo_service import CmoService, _parse_decision_payload, _parse_json_from_response


def make_brand_context() -> BrandContext:
    now = datetime.now()
    return BrandContext(
        brand=Brand(
            id="luminesce-brand-001",
            name="Luminesce",
            description="Clean skincare",
            createdAt=now,
            updatedAt=now,
        ),
        facts=[
            BrandFact(
                id="fact-001",
                brandId="luminesce-brand-001",
                category="origin",
                content="Founded by a biochemist",
                confidence=1.0,
                createdAt=now,
                updatedAt=now,
            )
        ],
        guidelines=[],
        products=[],
    )


class TestDecisionParsing:
    def test_parse_create_content_decision(self):
        raw = {
            "type": "CREATE_CONTENT",
            "contentType": "blog_post",
            "topic": "Barrier repair",
            "keyMessages": ["Ceramides restore barrier"],
            "targetAudience": "Women 28-45",
            "suggestedChannels": ["instagram"],
        }
        decision = _parse_decision_payload(raw)
        assert isinstance(decision, CreateContentDecision)
        assert decision.type == "CREATE_CONTENT"
        assert decision.contentType == "blog_post"

    def test_parse_no_action_decision(self):
        raw = {"type": "NO_ACTION", "reason": "No clear gap identified"}
        decision = _parse_decision_payload(raw)
        assert isinstance(decision, NoActionDecision)

    def test_unknown_decision_type_raises(self):
        raw = {"type": "UNKNOWN_TYPE", "data": "something"}
        with pytest.raises((ValueError, KeyError)):
            _parse_decision_payload(raw)


class TestJsonParsing:
    def test_strips_markdown_fences(self):
        text = "```json\n{\"key\": \"value\"}\n```"
        result = _parse_json_from_response(text)
        assert result == {"key": "value"}

    def test_parses_clean_json(self):
        text = '{"decisionType": "NO_ACTION"}'
        result = _parse_json_from_response(text)
        assert result["decisionType"] == "NO_ACTION"


class TestCmoRunResult:
    def test_confidence_must_be_0_to_1(self):
        with pytest.raises(Exception):
            CmoRunResult(
                decisionType=DecisionType.NO_ACTION,
                decisionPayload=NoActionDecision(type="NO_ACTION", reason="test"),
                rationale="test",
                evidenceRefs=[],
                confidence=1.5,  # invalid
                modelId="claude-sonnet-4-6",
            )

    def test_valid_run_result(self):
        result = CmoRunResult(
            decisionType=DecisionType.CREATE_CONTENT,
            decisionPayload=CreateContentDecision(
                type="CREATE_CONTENT",
                contentType="blog_post",
                topic="Skincare basics",
                keyMessages=["Key msg"],
                targetAudience="Women",
                suggestedChannels=["instagram"],
            ),
            rationale="Clear content gap in barrier repair education.",
            evidenceRefs=["fact-001"],
            confidence=0.85,
            modelId="claude-sonnet-4-6",
            durationMs=1200,
        )
        assert result.decisionType == DecisionType.CREATE_CONTENT
        assert result.confidence == 0.85


class TestCmoServiceWithMockedClaude:
    def test_service_run_with_mocked_claude(self):
        mock_response = {
            "decisionType": "CREATE_CONTENT",
            "decisionPayload": {
                "type": "CREATE_CONTENT",
                "contentType": "blog_post",
                "topic": "The science of ceramides",
                "keyMessages": ["Ceramides repair the skin barrier"],
                "targetAudience": "Women 28-45 with sensitive skin",
                "suggestedChannels": ["instagram", "email"],
            },
            "rationale": "Luminesce has a strong barrier repair product. Educational content on ceramide science aligns with the brand's evidence-first positioning.",
            "evidenceRefs": ["fact-001"],
            "confidence": 0.88,
        }
        import json

        service = CmoService.__new__(CmoService)
        mock_claude = MagicMock()
        mock_claude.model = "claude-sonnet-4-6"
        mock_claude.complete.return_value = (json.dumps(mock_response), {"modelId": "claude-sonnet-4-6"})
        service.claude = mock_claude

        context = make_brand_context()
        result = service.run(context)

        assert result.decisionType == DecisionType.CREATE_CONTENT
        assert result.confidence == 0.88
        assert "fact-001" in result.evidenceRefs
        mock_claude.complete.assert_called_once()
