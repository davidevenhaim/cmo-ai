from pydantic import BaseModel, field_validator, model_validator
from typing import Literal, List, Union, Optional, Any
from enum import Enum


class DecisionType(str, Enum):
    CREATE_CONTENT = "CREATE_CONTENT"
    START_RESEARCH = "START_RESEARCH"
    PROPOSE_CAMPAIGN = "PROPOSE_CAMPAIGN"
    REQUEST_APPROVAL = "REQUEST_APPROVAL"
    SEND_UPDATE = "SEND_UPDATE"
    NO_ACTION = "NO_ACTION"


class CreateContentDecision(BaseModel):
    type: Literal["CREATE_CONTENT"]
    contentType: Literal["blog_post", "social_caption", "email", "ad_copy"]
    topic: str
    angle: Optional[str] = None
    keyMessages: List[str]
    targetAudience: str
    suggestedChannels: List[str]
    opportunityId: Optional[str] = None
    tone: Optional[str] = None
    constraints: Optional[List[str]] = None


class StartResearchDecision(BaseModel):
    type: Literal["START_RESEARCH"]
    topic: str
    questions: List[str]
    rationale: str


class ProposeCampaignDecision(BaseModel):
    type: Literal["PROPOSE_CAMPAIGN"]
    campaignName: str
    objective: str
    targetAudience: str
    channels: List[str]
    keyMessages: List[str]
    estimatedDuration: str


class RequestApprovalDecision(BaseModel):
    type: Literal["REQUEST_APPROVAL"]
    subject: str
    description: str
    urgency: Literal["low", "medium", "high"]


class SendUpdateDecision(BaseModel):
    type: Literal["SEND_UPDATE"]
    recipient: str
    subject: str
    summary: str


class NoActionDecision(BaseModel):
    type: Literal["NO_ACTION"]
    reason: str


CmoDecision = Union[
    CreateContentDecision,
    StartResearchDecision,
    ProposeCampaignDecision,
    RequestApprovalDecision,
    SendUpdateDecision,
    NoActionDecision,
]


class CmoRunResult(BaseModel):
    decisionType: DecisionType
    decisionPayload: CmoDecision
    rationale: str
    evidenceRefs: List[str]
    confidence: float
    modelId: str
    modelVersion: Optional[str] = None
    durationMs: Optional[int] = None

    @field_validator("confidence")
    @classmethod
    def confidence_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("confidence must be between 0.0 and 1.0")
        return v

    @model_validator(mode="after")
    def decision_type_matches_payload(self) -> "CmoRunResult":
        payload_type = getattr(self.decisionPayload, "type", None)
        if payload_type != self.decisionType.value:
            raise ValueError(
                f"decisionType '{self.decisionType.value}' does not match "
                f"decisionPayload.type '{payload_type}'"
            )
        return self
