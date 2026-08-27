import json
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.schemas.operator import (
    CandidateAction,
    OperatorIntentProposal,
    OperatorIntentRequest,
    OperatorPrioritization,
    OperatorPrioritizeRequest,
    PrioritizedAction,
)
from app.services.operator_service import (
    OperatorService,
    _build_intent_message,
    _build_prioritize_message,
    filter_prioritization,
)

SUPPORTED_INTENTS = [
    "GET_DAILY_BRIEF",
    "ANALYZE_SALES",
    "CREATE_CONTENT_BRIEF",
    "LIST_ABANDONED",
]


def make_candidate(action_id: str = "act-1", **overrides) -> CandidateAction:
    base = dict(
        id=action_id,
        title="Recover 6 eligible abandoned checkouts",
        why="6 checkouts worth 642 ILS are recovery-eligible",
        category="REVENUE",
        evidenceSource="revenue_opportunities",
        expectedImpact="642 ILS recoverable",
        impactValue=642.0,
        currencyCode="ILS",
        confidence=0.8,
        requiredAction="EXECUTE",
        requiresApproval=True,
        deepLink="/revenue?section=abandoned",
        priority=1.0,
    )
    base.update(overrides)
    return CandidateAction(**base)


def make_prioritize_request(**overrides) -> OperatorPrioritizeRequest:
    base = dict(
        brandName="Luminesce",
        facts=["Sales last 30 days: 12000 ILS (down 8% vs previous)"],
        candidateActions=[make_candidate("act-1"), make_candidate("act-2")],
    )
    base.update(overrides)
    return OperatorPrioritizeRequest(**base)


class TestPrioritizeMessage:
    def test_includes_facts_and_candidate_ids(self):
        msg = _build_prioritize_message(make_prioritize_request())
        assert "Sales last 30 days: 12000 ILS" in msg
        assert '"act-1"' in msg
        assert '"act-2"' in msg
        assert "Luminesce" in msg

    def test_handles_empty_facts(self):
        msg = _build_prioritize_message(
            make_prioritize_request(facts=[], candidateActions=[])
        )
        assert "(no facts)" in msg


class TestFilterPrioritization:
    def test_drops_invented_action_ids(self):
        result = OperatorPrioritization(
            headline="h",
            narrative="n",
            prioritized=[
                PrioritizedAction(id="act-1", why="real", confidence=0.9),
                PrioritizedAction(id="invented-99", why="fake", confidence=0.9),
            ],
        )
        filtered = filter_prioritization(result, {"act-1", "act-2"})
        assert [p.id for p in filtered.prioritized] == ["act-1"]

    def test_keeps_all_valid_ids(self):
        result = OperatorPrioritization(
            headline="h",
            narrative="n",
            prioritized=[
                PrioritizedAction(id="act-2", why="w", confidence=0.5),
                PrioritizedAction(id="act-1", why="w", confidence=0.5),
            ],
        )
        filtered = filter_prioritization(result, {"act-1", "act-2"})
        assert [p.id for p in filtered.prioritized] == ["act-2", "act-1"]


class TestPrioritizeService:
    @patch("app.services.operator_service.ClaudeAdapter")
    def test_prioritize_filters_invented_ids_from_model(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps(
                {
                    "headline": "Focus on recovery",
                    "narrative": "Recovery value is the biggest lever today.",
                    "prioritized": [
                        {"id": "act-1", "why": "highest value", "confidence": 0.9},
                        {"id": "made-up", "why": "hallucinated", "confidence": 0.9},
                    ],
                }
            ),
            {"modelId": "test"},
        )
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        result = service.prioritize(make_prioritize_request())

        assert result.headline == "Focus on recovery"
        assert [p.id for p in result.prioritized] == ["act-1"]

    @patch("app.services.operator_service.ClaudeAdapter")
    def test_prioritize_rejects_malformed_response(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps({"headline": "only headline"}),
            {"modelId": "test"},
        )
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        with pytest.raises(ValidationError):
            service.prioritize(make_prioritize_request())

    @patch("app.services.operator_service.ClaudeAdapter")
    def test_prioritize_strips_markdown_fences(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        payload = {
            "headline": "h",
            "narrative": "n",
            "prioritized": [{"id": "act-1", "why": "w", "confidence": 0.7}],
        }
        mock_adapter.complete.return_value = (
            f"```json\n{json.dumps(payload)}\n```",
            {"modelId": "test"},
        )
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        result = service.prioritize(make_prioritize_request())
        assert result.prioritized[0].id == "act-1"


class TestIntentMessage:
    def test_includes_supported_intents_and_text(self):
        msg = _build_intent_message(
            OperatorIntentRequest(
                text="show abandoned carts", supportedIntents=SUPPORTED_INTENTS
            )
        )
        assert "LIST_ABANDONED" in msg
        assert "show abandoned carts" in msg


class TestIntentClassification:
    @patch("app.services.operator_service.ClaudeAdapter")
    def test_valid_intent_passes_through(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps(
                {
                    "intent": "LIST_ABANDONED",
                    "params": {},
                    "confidence": 0.95,
                    "clarification": None,
                }
            ),
            {"modelId": "test"},
        )
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        proposal = service.classify_intent(
            OperatorIntentRequest(
                text="show abandoned carts", supportedIntents=SUPPORTED_INTENTS
            )
        )
        assert proposal.intent == "LIST_ABANDONED"
        assert proposal.confidence == 0.95

    @patch("app.services.operator_service.ClaudeAdapter")
    def test_invented_intent_is_rejected_never_routed(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps(
                {
                    "intent": "DELETE_ALL_CUSTOMERS",
                    "params": {},
                    "confidence": 0.99,
                }
            ),
            {"modelId": "test"},
        )
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        proposal = service.classify_intent(
            OperatorIntentRequest(
                text="delete everything", supportedIntents=SUPPORTED_INTENTS
            )
        )
        assert proposal.intent is None
        assert proposal.confidence == 0.0
        assert proposal.clarification is not None

    @patch("app.services.operator_service.ClaudeAdapter")
    def test_null_intent_with_clarification(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = (
            json.dumps(
                {
                    "intent": None,
                    "params": {},
                    "confidence": 0.2,
                    "clarification": "I can list drafts or analyze sales.",
                }
            ),
            {"modelId": "test"},
        )
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        proposal = service.classify_intent(
            OperatorIntentRequest(
                text="make me a sandwich", supportedIntents=SUPPORTED_INTENTS
            )
        )
        assert proposal.intent is None
        assert proposal.clarification == "I can list drafts or analyze sales."

    @patch("app.services.operator_service.ClaudeAdapter")
    def test_malformed_intent_json_raises(self, mock_adapter_cls):
        mock_adapter = MagicMock()
        mock_adapter.complete.return_value = ("not json at all", {"modelId": "test"})
        mock_adapter_cls.return_value = mock_adapter

        service = OperatorService()
        with pytest.raises(json.JSONDecodeError):
            service.classify_intent(
                OperatorIntentRequest(
                    text="anything", supportedIntents=SUPPORTED_INTENTS
                )
            )
