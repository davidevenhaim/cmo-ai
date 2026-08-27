import json
import re
from pathlib import Path

from app.adapters.claude import ClaudeAdapter
from app.schemas.measurement import WeeklyInterpretation, WeeklyReviewRequest

_PROMPTS = Path(__file__).parent.parent / "prompts"
WEEKLY_SYSTEM_PROMPT = (_PROMPTS / "measurement_weekly_system.txt").read_text()


def _parse_json_from_response(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _build_weekly_message(req: WeeklyReviewRequest) -> str:
    facts_text = "\n".join(f"- {fact}" for fact in req.facts) or "- (no facts)"
    return f"BRAND: {req.brandName or 'Unknown'}\n\nFACTS:\n{facts_text}"


class MeasurementService:
    def __init__(self) -> None:
        self.claude = ClaudeAdapter()

    def interpret_weekly(self, req: WeeklyReviewRequest) -> WeeklyInterpretation:
        user_message = _build_weekly_message(req)
        raw_text, _ = self.claude.complete(WEEKLY_SYSTEM_PROMPT, user_message)
        raw_json = _parse_json_from_response(raw_text)
        return WeeklyInterpretation(**raw_json)
