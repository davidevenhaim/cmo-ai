"""Website Intelligence schemas.

The fact/interpretation split from M9.6 A3 is enforced structurally here:
the request carries measured findings, and the response types have no field
in which the model could return a metric.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

PageType = Literal[
    "HOMEPAGE",
    "PRODUCT",
    "COLLECTION",
    "BLOG",
    "BLOG_POST",
    "CART",
    "CHECKOUT",
    "LANDING",
    "POLICY",
    "CONTACT",
    "OTHER",
]

FindingCategory = Literal[
    "PERFORMANCE",
    "SEO",
    "ACCESSIBILITY",
    "BEST_PRACTICE",
    "CONVERSION",
    "CONTENT",
    "MOBILE",
    "TRUST",
    "PRODUCT_PAGE",
    "CHECKOUT",
    "TECHNICAL",
]

Severity = Literal["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


class WebsiteScores(BaseModel):
    performance: Optional[float] = None
    accessibility: Optional[float] = None
    seo: Optional[float] = None
    bestPractices: Optional[float] = None


class WebsiteContextFinding(BaseModel):
    """A measured fact. The model may cite it but must never restate it as its own."""

    pageUrl: str
    pageType: PageType = "OTHER"
    category: FindingCategory
    severity: Severity
    title: str
    evidenceSummary: str
    metricName: Optional[str] = None
    metricValue: Optional[float] = None
    metricUnit: Optional[str] = None


class WebsiteCroObservation(BaseModel):
    pageUrl: str
    category: FindingCategory
    severity: Severity
    title: str
    confidence: float


class WebsiteRegression(BaseModel):
    pageUrl: str
    metricName: str
    previousValue: float
    currentValue: float
    direction: Literal["IMPROVED", "REGRESSED"]


class WebsiteContext(BaseModel):
    evidenceStatus: str = "UNAVAILABLE"
    websiteUrl: Optional[str] = None
    lastAuditAt: Optional[datetime] = None
    pagesAudited: int = 0
    scores: WebsiteScores = Field(default_factory=WebsiteScores)
    openCritical: int = 0
    openHigh: int = 0
    openMedium: int = 0
    openTotal: int = 0
    topFindings: List[WebsiteContextFinding] = []
    croObservations: List[WebsiteCroObservation] = []
    regressions: List[WebsiteRegression] = []
    failureReason: Optional[str] = None


# --- Analysis (A3) ---------------------------------------------------------


class AnalysisInputFinding(BaseModel):
    fingerprint: str
    pageUrl: str
    pageType: str = "OTHER"
    category: FindingCategory
    severity: Severity
    title: str
    description: str
    metricName: Optional[str] = None
    metricValue: Optional[float] = None
    metricUnit: Optional[str] = None


class WebsiteAnalysisRequest(BaseModel):
    findings: List[AnalysisInputFinding]


class WebsiteAnalysisItem(BaseModel):
    # Must reference findings supplied in the request. Nest re-validates every
    # fingerprint and drops the item if none match.
    findingFingerprints: List[str]
    title: str
    interpretation: str
    proposedFix: str
    category: FindingCategory
    priority: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    confidence: float


class WebsiteAnalysisResult(BaseModel):
    recommendations: List[WebsiteAnalysisItem] = []
    modelId: str


# --- CRO review (A4) -------------------------------------------------------


class CroReviewRequest(BaseModel):
    pageUrl: str
    pageType: PageType = "OTHER"
    # Sanitised page text. Untrusted external input (invariant 4).
    pageText: str


class CroObservation(BaseModel):
    pageUrl: str
    category: FindingCategory
    severity: Severity
    title: str
    description: str
    suggestedFix: Optional[str] = None
    confidence: float
    observedEvidence: Optional[str] = None


class CroReviewResult(BaseModel):
    observations: List[CroObservation] = []
    modelId: str
