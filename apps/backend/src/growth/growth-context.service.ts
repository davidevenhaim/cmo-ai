import { Injectable } from "@nestjs/common";
import { AbandonedCheckoutService } from "./abandoned-checkout.service";
import { ReplenishmentService } from "./replenishment.service";
import { SegmentService } from "./segment.service";
import { UpsellService } from "./upsell.service";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface GrowthContext {
  // AVAILABLE = data is fresh; STALE = last-sync data, Shopify currently
  // unavailable; UNAVAILABLE = no sync has ever completed.
  evidenceStatus: "AVAILABLE" | "STALE" | "UNAVAILABLE";
  lastSyncAt?: Date;
  // No raw PII — aggregate counts only
  abandonedCheckouts: {
    activeCount: number;
    activeTotalValue: number;
    currencyCode: string;
    recoveryRate: number | null;
  };
  replenishmentCandidates: Array<{
    productName: string;
    windowDays: number;
    candidateCount: number;
  }>;
  lapsedCustomerCount: number;
  segments: Array<{ type: string; name: string; memberCount: number }>;
  crossSellOpportunities: Array<{
    sourceProduct: string;
    targetProduct: string;
    strength: number;
    sampleSize: number | null;
  }>;
  campaigns: Record<string, number>;
}

@Injectable()
export class GrowthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abandonedCheckouts: AbandonedCheckoutService,
    private readonly replenishment: ReplenishmentService,
    private readonly segments: SegmentService,
    private readonly upsell: UpsellService,
  ) {}

  async build(): Promise<GrowthContext> {
    const [
      checkoutSummary,
      replenishmentCandidates,
      segmentSummary,
      crossSellRecs,
      campaignCounts,
      recoveryStats,
      currencyRow,
      lastSync,
    ] = await Promise.all([
      this.abandonedCheckouts.getSummary(),
      this.replenishment.getCandidates(),
      this.segments.getSegmentSummary(),
      this.upsell.listAll(),
      this.prisma.campaign.groupBy({
        by: ["status"],
        where: { brandId: BRAND_ID },
        _count: { id: true },
      }),
      this.prisma.abandonedCheckout.aggregate({
        where: {
          brandId: BRAND_ID,
          status: { in: ["RECOVERED", "EXPIRED", "SUPPRESSED"] },
        },
        _count: { id: true },
      }),
      this.prisma.abandonedCheckout.findFirst({
        where: { brandId: BRAND_ID },
        select: { currencyCode: true },
      }),
      this.prisma.growthSyncRun.findFirst({
        where: { brandId: BRAND_ID, status: { in: ["COMPLETED", "PARTIAL"] } },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true, status: true },
      }),
    ]);

    const evidenceStatus = this.resolveEvidenceStatus(lastSync);
    const recoveredCount = checkoutSummary.byStatus["RECOVERED"] ?? 0;
    const closedCount = recoveryStats._count.id;
    const recoveryRate = closedCount > 0 ? recoveredCount / closedCount : null;

    const lapsedSegment = segmentSummary.find(
      (s) => s.type === "LAPSED_CUSTOMER",
    );

    const campaigns: Record<string, number> = {};
    for (const row of campaignCounts) {
      campaigns[row.status] = row._count.id;
    }

    return {
      evidenceStatus,
      lastSyncAt: lastSync?.completedAt ?? undefined,
      abandonedCheckouts: {
        activeCount: checkoutSummary.activeCount,
        activeTotalValue: checkoutSummary.activeTotalValue,
        currencyCode: currencyRow?.currencyCode ?? "USD",
        recoveryRate,
      },
      replenishmentCandidates: replenishmentCandidates.map((r) => ({
        productName: r.productName,
        windowDays: r.windowDays,
        candidateCount: r.contacts.length,
      })),
      lapsedCustomerCount: lapsedSegment?.memberCount ?? 0,
      segments: segmentSummary.map((s) => ({
        type: s.type,
        name: s.name,
        memberCount: s.memberCount,
      })),
      crossSellOpportunities: crossSellRecs
        .filter((r) => r.source === "COMMERCE" && r.strength != null)
        .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
        .slice(0, 10)
        .map((r) => ({
          sourceProduct: r.sourceProduct.name,
          targetProduct: r.targetProduct.name,
          strength: r.strength ?? 0,
          sampleSize: r.sampleSize,
        })),
      campaigns,
    };
  }

  // Stale = last sync is older than 25 hours (slightly above the daily cadence).
  private resolveEvidenceStatus(
    lastSync: { completedAt: Date | null; status: string } | null,
  ): "AVAILABLE" | "STALE" | "UNAVAILABLE" {
    if (!lastSync?.completedAt) return "UNAVAILABLE";
    const ageMs = Date.now() - lastSync.completedAt.getTime();
    const staleThresholdMs = 25 * 60 * 60 * 1000;
    return ageMs > staleThresholdMs ? "STALE" : "AVAILABLE";
  }
}
