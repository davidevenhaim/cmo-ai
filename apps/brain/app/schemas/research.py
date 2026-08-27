from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ResearchFindingPreview(BaseModel):
    id: str
    title: str
    sourceType: str
    topic: Optional[str] = None
    relevanceScore: float
    excerpt: str
    url: str
    publishedAt: Optional[datetime] = None


class OpportunityPreview(BaseModel):
    id: str
    type: str
    title: str
    summary: str
    relevanceScore: float
    urgencyScore: float


class ResearchContext(BaseModel):
    runAt: datetime
    available: bool
    stale: bool
    topFindings: List[ResearchFindingPreview] = []
    topOpportunities: List[OpportunityPreview] = []
    failureReason: Optional[str] = None
