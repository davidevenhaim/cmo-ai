from typing import Any

from pydantic import BaseModel, Field


class CandidateAction(BaseModel):
    """Deterministic candidate action computed by the backend.

    The brain may only reorder and explain these — never invent new ones.
    """

    id: str
    title: str
    why: str
    category: str
    evidenceSource: str
    expectedImpact: str | None = None
    impactValue: float | None = None
    currencyCode: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    requiredAction: str
    requiresApproval: bool
    deepLink: str
    priority: float


class OperatorPrioritizeRequest(BaseModel):
    brandName: str | None = None
    # Bounded deterministic fact lines (no PII, no raw DB rows)
    facts: list[str] = Field(default_factory=list, max_length=60)
    candidateActions: list[CandidateAction] = Field(
        default_factory=list, max_length=25
    )


class PrioritizedAction(BaseModel):
    id: str
    why: str
    confidence: float = Field(ge=0.0, le=1.0)


class OperatorPrioritization(BaseModel):
    headline: str
    narrative: str
    prioritized: list[PrioritizedAction]


class OperatorIntentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    supportedIntents: list[str] = Field(min_length=1)


class OperatorIntentProposal(BaseModel):
    # None when no supported intent fits — caller asks for clarification.
    intent: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0.0, le=1.0)
    clarification: str | None = None
