from pydantic import BaseModel, field_validator
from typing import Optional, List, Literal
from enum import Enum


class Channel(str, Enum):
    INSTAGRAM = "INSTAGRAM"
    FACEBOOK = "FACEBOOK"
    LINKEDIN = "LINKEDIN"
    X = "X"
    REDDIT = "REDDIT"
    BLOG = "BLOG"
    EMAIL = "EMAIL"
    GENERIC = "GENERIC"


class ContentFormat(str, Enum):
    POST = "POST"
    CAROUSEL = "CAROUSEL"
    STORY = "STORY"
    SHORT_VIDEO = "SHORT_VIDEO"
    LONG_FORM = "LONG_FORM"
    COMMENT = "COMMENT"
    THREAD = "THREAD"


class CarouselSlide(BaseModel):
    slideNumber: int
    text: str
    visualDirection: Optional[str] = None


class CreativeDirection(BaseModel):
    aspectRatio: Optional[str] = None
    visualObjective: Optional[str] = None
    mood: Optional[str] = None
    requiredElements: Optional[List[str]] = None
    forbiddenElements: Optional[List[str]] = None
    productRefs: Optional[List[str]] = None
    textHierarchy: Optional[List[str]] = None


class GeneratedContent(BaseModel):
    channel: Channel
    format: ContentFormat
    # Shared / general
    caption: Optional[str] = None
    callToAction: Optional[str] = None
    hashtags: Optional[List[str]] = None
    # Instagram carousel
    hookSlide: Optional[str] = None
    slides: Optional[List[CarouselSlide]] = None
    closingCta: Optional[str] = None
    # X / Reddit / LinkedIn text
    text: Optional[str] = None
    thread: Optional[List[str]] = None
    # Reddit
    title: Optional[str] = None
    body: Optional[str] = None
    subredditSuggestion: Optional[str] = None
    # Blog
    outline: Optional[List[str]] = None
    metaDescription: Optional[str] = None
    # Weave creative direction (M8)
    creativeDirection: Optional[CreativeDirection] = None


class CriticEvaluation(BaseModel):
    brandFit: float
    channelFit: float
    evidenceAlignment: float
    clarity: float
    originality: float
    promotionalIntensity: float
    claimRisk: float
    ctaQuality: float
    overall: float
    issues: List[str]
    passesReview: bool

    @field_validator(
        "brandFit",
        "channelFit",
        "evidenceAlignment",
        "clarity",
        "originality",
        "promotionalIntensity",
        "claimRisk",
        "ctaQuality",
        "overall",
    )
    @classmethod
    def score_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("score must be between 0.0 and 1.0")
        return v


# --- Request / response schemas for brain endpoints ---

class ContentBriefRequest(BaseModel):
    objective: str
    topic: str
    angle: str
    targetAudience: str
    channel: Channel
    format: ContentFormat
    keyMessage: str
    callToAction: Optional[str] = None
    tone: str
    constraints: List[str] = []


class ContentBrandContext(BaseModel):
    name: str
    voice: Optional[str] = None
    audience: Optional[str] = None
    guidelines: List[dict] = []
    activeProducts: List[dict] = []


class ContentEvidence(BaseModel):
    brandFacts: List[str] = []
    commerceSummary: Optional[str] = None
    researchFindings: List[str] = []
    opportunitySummary: Optional[str] = None
    ownerHint: Optional[str] = None


class ContentGenerationRequest(BaseModel):
    brief: ContentBriefRequest
    brandContext: ContentBrandContext
    evidence: ContentEvidence
    revisionFeedback: Optional[str] = None


class ContentCriticRequest(BaseModel):
    content: GeneratedContent
    brief: ContentBriefRequest
    brandContext: ContentBrandContext
