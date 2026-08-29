from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.schemas.commerce import CommerceContext
from app.schemas.research import ResearchContext
from app.schemas.website import WebsiteContext
from app.schemas.whatsapp import WhatsAppContext


class BrandSource(BaseModel):
    id: str
    brandId: str
    type: str
    label: str
    url: Optional[str] = None
    fetchedAt: Optional[datetime] = None
    createdAt: datetime


class BrandFact(BaseModel):
    id: str
    brandId: str
    category: str
    content: str
    confidence: float
    sourceId: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime


class BrandGuideline(BaseModel):
    id: str
    brandId: str
    category: str
    rule: str
    example: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime


class Product(BaseModel):
    id: str
    brandId: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    tags: List[str] = []
    active: bool = True
    createdAt: datetime
    updatedAt: datetime


class Brand(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    voice: Optional[str] = None
    audience: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime


class GrowthAbandonedCheckouts(BaseModel):
    activeCount: int
    activeTotalValue: float
    currencyCode: str
    recoveryRate: Optional[float] = None


class GrowthReplenishmentCandidate(BaseModel):
    productName: str
    windowDays: int
    candidateCount: int


class GrowthSegment(BaseModel):
    type: str
    name: str
    memberCount: int


class GrowthCrossSellOpportunity(BaseModel):
    sourceProduct: str
    targetProduct: str
    strength: float
    sampleSize: Optional[int] = None


class GrowthContext(BaseModel):
    evidenceStatus: str = "AVAILABLE"  # AVAILABLE | STALE | UNAVAILABLE
    lastSyncAt: Optional[datetime] = None
    abandonedCheckouts: GrowthAbandonedCheckouts
    replenishmentCandidates: List[GrowthReplenishmentCandidate] = []
    lapsedCustomerCount: int = 0
    segments: List[GrowthSegment] = []
    crossSellOpportunities: List[GrowthCrossSellOpportunity] = []
    campaigns: dict = {}


class BrandContext(BaseModel):
    brand: Brand
    facts: List[BrandFact] = []
    guidelines: List[BrandGuideline] = []
    products: List[Product] = []
    hint: Optional[str] = None
    commerceContext: Optional[CommerceContext] = None
    researchContext: Optional[ResearchContext] = None
    growthContext: Optional[GrowthContext] = None
    websiteContext: Optional[WebsiteContext] = None
    whatsappContext: Optional[WhatsAppContext] = None
