import json
import re
import time
from pathlib import Path

from app.schemas.content import (
    ContentGenerationRequest,
    GeneratedContent,
    Channel,
    ContentFormat,
)
from app.adapters.factory import get_llm

SYSTEM_PROMPT = (
    Path(__file__).parent.parent / "prompts" / "content_system.txt"
).read_text()


def _parse_json_from_response(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _build_user_message(req: ContentGenerationRequest) -> str:
    brief = req.brief
    brand = req.brandContext
    evidence = req.evidence

    guidelines_text = "\n".join(
        f"  [{g.get('category', '')}]: {g.get('rule', '')}"
        + (f"\n    Example: {g['example']}" if g.get("example") else "")
        for g in brand.guidelines
    )
    products_text = "\n".join(
        f"  - {p.get('name', '')}"
        + (f" ({p['category']})" if p.get("category") else "")
        + (f": {p['description']}" if p.get("description") else "")
        for p in brand.activeProducts
    )

    trusted_facts = "\n".join(f"  - {f}" for f in evidence.brandFacts) or "  None"
    commerce_block = (
        f"\nCommerce data (TRUSTED):\n  {evidence.commerceSummary}"
        if evidence.commerceSummary
        else ""
    )

    research_block = ""
    if evidence.researchFindings:
        findings_text = "\n".join(
            f"  - {f}" for f in evidence.researchFindings
        )
        research_block = (
            "\n\n--- RESEARCH EVIDENCE (UNTRUSTED external sources) ---\n"
            "The following are from external web sources. Use for inspiration only.\n"
            "Do NOT make these into brand claims or product facts.\n"
            f"{findings_text}\n"
            "--- END RESEARCH EVIDENCE ---"
        )

    opportunity_block = (
        f"\nOpportunity context: {evidence.opportunitySummary}"
        if evidence.opportunitySummary
        else ""
    )
    hint_block = (
        f"\nOwner direction: {evidence.ownerHint}" if evidence.ownerHint else ""
    )
    revision_block = (
        f"\n\n=== REVISION INSTRUCTIONS ===\n"
        f"This is a revision. Address the following feedback:\n{req.revisionFeedback}\n"
        f"=== END REVISION INSTRUCTIONS ==="
        if req.revisionFeedback
        else ""
    )

    constraints_text = (
        "\n".join(f"  - {c}" for c in brief.constraints)
        if brief.constraints
        else "  None"
    )

    return (
        f"BRAND: {brand.name}\n"
        f"Voice/Tone: {brand.voice or 'N/A'}\n"
        f"Audience: {brand.audience or 'N/A'}\n\n"
        f"BRAND GUIDELINES:\n{guidelines_text or '  None'}\n\n"
        f"ACTIVE PRODUCTS:\n{products_text or '  None'}\n\n"
        f"TRUSTED EVIDENCE (brand facts):\n{trusted_facts}"
        f"{commerce_block}"
        f"{research_block}"
        f"{opportunity_block}"
        f"{hint_block}\n\n"
        f"CONTENT BRIEF:\n"
        f"  Objective: {brief.objective}\n"
        f"  Topic: {brief.topic}\n"
        f"  Angle: {brief.angle}\n"
        f"  Target audience: {brief.targetAudience}\n"
        f"  Channel: {brief.channel.value}\n"
        f"  Format: {brief.format.value}\n"
        f"  Key message: {brief.keyMessage}\n"
        f"  CTA: {brief.callToAction or 'None'}\n"
        f"  Tone: {brief.tone}\n"
        f"  Constraints:\n{constraints_text}"
        f"{revision_block}\n\n"
        f"Generate channel-native content for {brief.channel.value} {brief.format.value}."
    )


class ContentService:
    def __init__(self) -> None:
        self.llm = get_llm()

    def generate(self, req: ContentGenerationRequest) -> GeneratedContent:
        user_message = _build_user_message(req)
        raw_text, _ = self.llm.complete(SYSTEM_PROMPT, user_message)
        raw_json = _parse_json_from_response(raw_text)
        return GeneratedContent(**raw_json)
