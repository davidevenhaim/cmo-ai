import json
import re
from pathlib import Path

from app.schemas.content import (
    ContentCriticRequest,
    CriticEvaluation,
    GeneratedContent,
    ContentBriefRequest,
    ContentBrandContext,
)
from app.adapters.factory import get_llm

CRITIC_SYSTEM_PROMPT = (
    Path(__file__).parent.parent / "prompts" / "critic_system.txt"
).read_text()

# Deterministic post-critic safety gate: a draft must fail review when any
# critical safety dimension scores below its floor, regardless of overall
# score. All dimensions are 0.0-1.0 where 1.0 = safe/good, so LOW scores
# are risky (claimRisk 0.0 = dangerous unsupported claims).
SAFETY_GATE_FLOORS: dict[str, float] = {
    "claimRisk": 0.5,  # unsupported/medical claim risk
    "brandFit": 0.4,  # brand policy violation
    "evidenceAlignment": 0.4,  # severe evidence mismatch
}


def apply_safety_gate(evaluation: CriticEvaluation) -> CriticEvaluation:
    violations = [
        f"SAFETY_GATE: {dimension} {getattr(evaluation, dimension):.2f} "
        f"below required floor {floor:.2f}"
        for dimension, floor in SAFETY_GATE_FLOORS.items()
        if getattr(evaluation, dimension) < floor
    ]
    if not violations:
        return evaluation
    return evaluation.model_copy(
        update={
            "passesReview": False,
            "issues": [*evaluation.issues, *violations],
        }
    )


def _parse_json_from_response(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _build_critic_message(req: ContentCriticRequest) -> str:
    content = req.content
    brief = req.brief
    brand = req.brandContext

    guidelines_text = "\n".join(
        f"  [{g.get('category', '')}]: {g.get('rule', '')}"
        for g in brand.guidelines
    )

    content_dict = content.model_dump(exclude_none=True)
    content_json = json.dumps(content_dict, indent=2)

    return (
        f"BRAND: {brand.name}\n"
        f"Voice/Tone: {brand.voice or 'N/A'}\n"
        f"Audience: {brand.audience or 'N/A'}\n\n"
        f"BRAND GUIDELINES:\n{guidelines_text or '  None'}\n\n"
        f"CONTENT BRIEF:\n"
        f"  Objective: {brief.objective}\n"
        f"  Topic: {brief.topic}\n"
        f"  Angle: {brief.angle}\n"
        f"  Target audience: {brief.targetAudience}\n"
        f"  Channel: {brief.channel.value}\n"
        f"  Format: {brief.format.value}\n"
        f"  Key message: {brief.keyMessage}\n"
        f"  CTA: {brief.callToAction or 'None'}\n"
        f"  Tone: {brief.tone}\n\n"
        f"CONTENT TO EVALUATE:\n{content_json}"
    )


class CriticService:
    def __init__(self) -> None:
        self.llm = get_llm()

    def critique(self, req: ContentCriticRequest) -> CriticEvaluation:
        user_message = _build_critic_message(req)
        raw_text, _ = self.llm.complete(CRITIC_SYSTEM_PROMPT, user_message)
        raw_json = _parse_json_from_response(raw_text)
        return apply_safety_gate(CriticEvaluation(**raw_json))
