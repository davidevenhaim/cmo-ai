"""Aggregate WhatsApp performance context.

Deliberately contains no identifiers: no phone numbers, no contact ids, no
message bodies. The CMO reasons about channel economics, not about people.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class WhatsAppAbandonedCart(BaseModel):
    eligibleCarts: int = 0
    messagesSent: int = 0
    recovered: int = 0
    # ATTRIBUTED, never incremental. The prompt says so too.
    attributedRevenue: float = 0
    attributedProfit: float = 0
    incentiveCost: float = 0


class WhatsAppSuppressed(BaseModel):
    noConsent: int = 0
    frequencyCap: int = 0
    purchasedBeforeSend: int = 0
    invalidPhone: int = 0
    inventoryUnavailable: int = 0
    other: int = 0


class WhatsAppLadderStep(BaseModel):
    stepNumber: int
    delayHours: float
    sent: int = 0
    skipped: int = 0
    offerType: Optional[str] = None


class WhatsAppAutomationSummary(BaseModel):
    type: str
    mode: Literal["DISABLED", "DRY_RUN", "LIVE"]
    successCount: int = 0
    failureCount: int = 0
    lastRunAt: Optional[datetime] = None


class WhatsAppContext(BaseModel):
    evidenceStatus: str = "UNAVAILABLE"
    connectionStatus: str = "NOT_CONFIGURED"
    # Store currency (C3). Never assume a symbol.
    currencyCode: str = "USD"
    abandonedCart: WhatsAppAbandonedCart = Field(
        default_factory=WhatsAppAbandonedCart
    )
    suppressed: WhatsAppSuppressed = Field(default_factory=WhatsAppSuppressed)
    ladderSteps: List[WhatsAppLadderStep] = []
    automations: List[WhatsAppAutomationSummary] = []
    failureReason: Optional[str] = None
