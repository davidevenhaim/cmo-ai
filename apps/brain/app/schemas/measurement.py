from pydantic import BaseModel, Field


class WeeklyReviewRequest(BaseModel):
    brandName: str | None = None
    # Bounded deterministic fact lines computed by the backend — the only
    # numbers that exist. Claude interprets them, never adjusts them.
    facts: list[str] = Field(default_factory=list, max_length=80)


class WeeklyInterpretation(BaseModel):
    headline: str
    narrative: str
