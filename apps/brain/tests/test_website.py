"""M9.6 Website Intelligence — brain-side reasoning.

The load-bearing assertions here are the A3 ones: the model may interpret
measured facts, but nothing it returns can become a measurement, and anything
it cites that we did not supply is dropped.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.schemas.website import (
    AnalysisInputFinding,
    CroReviewRequest,
    WebsiteAnalysisRequest,
)
from app.services.website_service import (
    WebsiteService,
    _build_analysis_message,
    _build_cro_message,
)


def make_finding(fingerprint: str = "fp-1", **overrides) -> AnalysisInputFinding:
    base = dict(
        fingerprint=fingerprint,
        pageUrl="https://example.com",
        pageType="HOMEPAGE",
        category="PERFORMANCE",
        severity="HIGH",
        title="Largest Contentful Paint is slow",
        description="LCP measured at 4.20s",
        metricName="LCP",
        metricValue=4200.0,
        metricUnit="ms",
    )
    base.update(overrides)
    return AnalysisInputFinding(**base)


def make_service(response_text: str) -> WebsiteService:
    llm = MagicMock()
    llm.model_id = "test-model"
    llm.complete.return_value = (response_text, {"modelId": "test-model"})
    with patch("app.services.website_service.get_llm", return_value=llm):
        return WebsiteService()


def analysis_response(**overrides) -> str:
    rec = {
        "findingFingerprints": ["fp-1"],
        "title": "Fix the homepage hero",
        "interpretation": "The oversized hero is likely driving the slow LCP.",
        "proposedFix": "Serve the hero as WebP and preload it.",
        "category": "PERFORMANCE",
        "priority": "HIGH",
        "confidence": 0.8,
    }
    rec.update(overrides)
    return json.dumps({"recommendations": [rec]})


class TestAnalysisMessage:
    def test_includes_the_measurement_as_a_preformatted_fact(self):
        message = _build_analysis_message(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )
        assert "LCP = 4200.0 ms" in message
        assert "do not restate or alter the numbers" in message

    def test_omits_measurement_when_the_finding_has_no_metric(self):
        message = _build_analysis_message(
            WebsiteAnalysisRequest(
                findings=[
                    make_finding(metricName=None, metricValue=None, metricUnit=None)
                ]
            )
        )
        assert '"measurement": null' in message


class TestAnalyze:
    def test_returns_a_grounded_recommendation(self):
        service = make_service(analysis_response())
        result = service.analyze(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )

        assert len(result.recommendations) == 1
        assert result.recommendations[0].findingFingerprints == ["fp-1"]
        assert result.modelId == "test-model"

    def test_drops_a_recommendation_citing_an_unknown_fingerprint(self):
        service = make_service(
            analysis_response(findingFingerprints=["fp-hallucinated"])
        )
        result = service.analyze(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )
        assert result.recommendations == []

    def test_keeps_only_the_grounded_fingerprints(self):
        service = make_service(
            analysis_response(findingFingerprints=["fp-1", "fp-invented"])
        )
        result = service.analyze(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )
        assert result.recommendations[0].findingFingerprints == ["fp-1"]

    def test_does_not_call_the_model_with_no_findings(self):
        llm = MagicMock()
        llm.model_id = "test-model"
        with patch("app.services.website_service.get_llm", return_value=llm):
            service = WebsiteService()
        result = service.analyze(WebsiteAnalysisRequest(findings=[]))

        assert result.recommendations == []
        llm.complete.assert_not_called()

    def test_strips_markdown_fences_from_the_response(self):
        service = make_service(f"```json\n{analysis_response()}\n```")
        result = service.analyze(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )
        assert len(result.recommendations) == 1

    def test_recommendation_has_no_field_for_a_metric(self):
        service = make_service(analysis_response())
        result = service.analyze(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )
        # Structural guarantee: interpretation cannot carry a measurement.
        fields = result.recommendations[0].model_dump().keys()
        assert "metricValue" not in fields
        assert "metricName" not in fields

    def test_caps_the_number_of_recommendations(self):
        many = json.dumps(
            {
                "recommendations": [
                    {
                        "findingFingerprints": ["fp-1"],
                        "title": f"Rec {i}",
                        "interpretation": "x",
                        "proposedFix": "y",
                        "category": "PERFORMANCE",
                        "priority": "LOW",
                        "confidence": 0.5,
                    }
                    for i in range(30)
                ]
            }
        )
        service = make_service(many)
        result = service.analyze(
            WebsiteAnalysisRequest(findings=[make_finding()])
        )
        assert len(result.recommendations) <= 10

    def test_raises_on_unparseable_output(self):
        service = make_service("this is not json")
        with pytest.raises(json.JSONDecodeError):
            service.analyze(WebsiteAnalysisRequest(findings=[make_finding()]))


class TestCroMessage:
    def test_marks_page_text_as_untrusted(self):
        message = _build_cro_message(
            CroReviewRequest(
                pageUrl="https://example.com",
                pageType="HOMEPAGE",
                pageText="Buy our serum",
            )
        )
        assert "untrusted external content" in message
        assert "BEGIN PAGE TEXT" in message
        assert "END PAGE TEXT" in message

    def test_bounds_the_page_text(self):
        message = _build_cro_message(
            CroReviewRequest(
                pageUrl="https://example.com",
                pageType="HOMEPAGE",
                pageText="x" * 50_000,
            )
        )
        # Measure the delimited block, not the whole message — the surrounding
        # template legitimately contains its own "x" characters.
        body = message.split("---\n", 1)[1].split("\n--- END", 1)[0]
        assert len(body) == 4000


class TestCroReview:
    def _response(self, **overrides) -> str:
        obs = {
            "pageUrl": "https://example.com",
            "category": "CONVERSION",
            "severity": "MEDIUM",
            "title": "Primary call to action is unclear",
            "description": "No obvious single next step above the fold.",
            "suggestedFix": "Add one primary CTA.",
            "confidence": 0.6,
            "observedEvidence": "Shop / Learn more / Our story",
        }
        obs.update(overrides)
        return json.dumps({"observations": [obs]})

    def test_returns_observations(self):
        service = make_service(self._response())
        result = service.cro_review(
            CroReviewRequest(
                pageUrl="https://example.com",
                pageType="HOMEPAGE",
                pageText="content",
            )
        )
        assert len(result.observations) == 1
        assert result.observations[0].category == "CONVERSION"

    def test_pins_observations_to_the_reviewed_page(self):
        service = make_service(
            self._response(pageUrl="https://attacker.example/elsewhere")
        )
        result = service.cro_review(
            CroReviewRequest(
                pageUrl="https://example.com",
                pageType="HOMEPAGE",
                pageText="content",
            )
        )
        # The model cannot attribute an observation to a page it never saw.
        assert result.observations[0].pageUrl == "https://example.com"

    def test_skips_the_model_for_empty_page_text(self):
        llm = MagicMock()
        llm.model_id = "test-model"
        with patch("app.services.website_service.get_llm", return_value=llm):
            service = WebsiteService()

        result = service.cro_review(
            CroReviewRequest(
                pageUrl="https://example.com", pageType="HOMEPAGE", pageText="   "
            )
        )
        assert result.observations == []
        llm.complete.assert_not_called()

    def test_caps_the_number_of_observations(self):
        many = json.dumps(
            {
                "observations": [
                    {
                        "pageUrl": "https://example.com",
                        "category": "CONTENT",
                        "severity": "LOW",
                        "title": f"Observation {i}",
                        "description": "x",
                        "confidence": 0.4,
                    }
                    for i in range(30)
                ]
            }
        )
        service = make_service(many)
        result = service.cro_review(
            CroReviewRequest(
                pageUrl="https://example.com",
                pageType="HOMEPAGE",
                pageText="content",
            )
        )
        assert len(result.observations) <= 6

    def test_observation_has_no_field_for_a_metric(self):
        service = make_service(self._response())
        result = service.cro_review(
            CroReviewRequest(
                pageUrl="https://example.com",
                pageType="HOMEPAGE",
                pageText="content",
            )
        )
        fields = result.observations[0].model_dump().keys()
        assert "metricValue" not in fields
        assert "metricName" not in fields
