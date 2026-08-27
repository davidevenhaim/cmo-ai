from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import datetime


class CommerceVariant(BaseModel):
    id: str
    title: str
    sku: Optional[str] = None
    price: float
    compareAtPrice: Optional[float] = None
    inventoryQuantity: int
    available: bool


class CommerceProduct(BaseModel):
    id: str
    title: str
    handle: str
    status: str
    category: Optional[str] = None
    tags: List[str] = []
    variants: List[CommerceVariant] = []
    totalInventory: int
    minPrice: float
    maxPrice: float


class InventoryVariantSnapshot(BaseModel):
    variantId: str
    title: str
    quantity: int


class InventorySnapshot(BaseModel):
    productId: str
    productTitle: str
    totalUnits: int
    lowStock: bool
    variants: List[InventoryVariantSnapshot] = []


class CommerceOrderLineItem(BaseModel):
    productId: Optional[str] = None
    productTitle: str
    quantity: int
    unitPrice: float


class CommerceOrder(BaseModel):
    id: str
    createdAt: datetime
    totalPrice: float
    lineItems: List[CommerceOrderLineItem] = []
    customerEmail: Optional[str] = None
    isRepeatCustomer: bool


class CommerceCustomerSummary(BaseModel):
    totalCustomers: int
    repeatCustomers: int
    repeatRate: float
    newThisPeriod: int


class RevenueByProduct(BaseModel):
    productId: str
    productTitle: str
    revenue: float
    units: int


class PreviousPeriod(BaseModel):
    revenue: Optional[float] = None
    orderCount: Optional[int] = None
    aov: Optional[float] = None


class CommerceMetrics(BaseModel):
    periodStart: datetime
    periodEnd: datetime
    revenue: float
    orderCount: int
    aov: float
    unitsSold: int
    currencyCode: str = "USD"
    metricsIncomplete: bool = False
    revenueByProduct: List[RevenueByProduct] = []
    lowInventoryProducts: List[InventorySnapshot] = []
    customerSummary: Optional[CommerceCustomerSummary] = None
    previousPeriod: Optional[PreviousPeriod] = None


class CommerceContext(BaseModel):
    fetchedAt: datetime
    shopName: Optional[str] = None
    evidenceStatus: Literal["AVAILABLE", "STALE", "UNAVAILABLE"]
    metrics: Optional[CommerceMetrics] = None
    topProducts: List[CommerceProduct] = []
    failureReason: Optional[str] = None
    snapshotId: Optional[str] = None
