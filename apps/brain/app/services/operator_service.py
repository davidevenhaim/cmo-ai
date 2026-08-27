import json
import re
from pathlib import Path

from app.adapters.claude import ClaudeAdapter
from app.schemas.operator import (
    OperatorIntentProposal,
    OperatorIntentRequest,
    OperatorPrioritization,
    OperatorPrioritizeRequest,
)

_PROMPTS = Path(__file__).parent.parent / "prompts"
PRIORITIZE_SYSTEM_PROMPT = (_PROMPTS / "operator_prioritize_system.txt").read_text()
INTENT_SYSTEM_PROMPT = (_PROMPTS / "operator_intent_system.txt").read_text()


def _parse_json_from_response(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _build_prioritize_message(req: OperatorPrioritizeRequest) -> str:
    facts_text = "\n".join(f"- {fact}" for fact in req.facts) or "- (no facts)"
    actions = [
        {
            "id": a.id,
            "title": a.title,
            "why": a.why,
            "category": a.category,
            "evidenceSource": a.evidenceSource,
            "expectedImpact": a.expectedImpact,
            "requiredAction": a.requiredAction,
            "requiresApproval": a.requiresApproval,
        }
        for a in req.candidateActions
    ]
    return (
        f"BRAND: {req.brandName or 'Unknown'}\n\n"
        f"FACTS:\n{facts_text}\n\n"
        f"CANDIDATE ACTIONS:\n{json.dumps(actions, indent=2)}"
    )


def _build_intent_message(req: OperatorIntentRequest) -> str:
    intents_text = "\n".join(f"- {intent}" for intent in req.supportedIntents)
    return f"SUPPORTED INTENTS:\n{intents_text}\n\nUSER REQUEST:\n{req.text}"


def filter_prioritization(
    result: OperatorPrioritization, candidate_ids: set[str]
) -> OperatorPrioritization:
    """Drop any prioritized entry whose id was not in the candidate set."""
    kept = [p for p in result.prioritized if p.id in candidate_ids]
    if len(kept) == len(result.prioritized):
        return result
    return result.model_copy(update={"prioritized": kept})


class OperatorService:
    def __init__(self) -> None:
        self.claude = ClaudeAdapter()

    def prioritize(self, req: OperatorPrioritizeRequest) -> OperatorPrioritization:
        user_message = _build_prioritize_message(req)
        raw_text, _ = self.claude.complete(PRIORITIZE_SYSTEM_PROMPT, user_message)
        raw_json = _parse_json_from_response(raw_text)
        result = OperatorPrioritization(**raw_json)
        candidate_ids = {a.id for a in req.candidateActions}
        return filter_prioritization(result, candidate_ids)

    def classify_intent(self, req: OperatorIntentRequest) -> OperatorIntentProposal:
        user_message = _build_intent_message(req)
        raw_text, _ = self.claude.complete(INTENT_SYSTEM_PROMPT, user_message)
        raw_json = _parse_json_from_response(raw_text)
        proposal = OperatorIntentProposal(**raw_json)
        if proposal.intent is not None and proposal.intent not in req.supportedIntents:
            # Model invented an intent — treat as unclassifiable, never route it.
            return OperatorIntentProposal(
                intent=None,
                params={},
                confidence=0.0,
                clarification=(
                    "Could not map the request to a supported action."
                ),
            )
        return proposal
