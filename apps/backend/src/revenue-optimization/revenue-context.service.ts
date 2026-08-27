import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RevenueAttributionService } from "./revenue-attribution.service";

const BRAND_ID = "luminesce-brand-001";

export interface RevenueOptimizationContext {
  summary: {
    openOpportunities: number;
    openByType: Record<string, number>;
    last30Days: {
      recovered: number;
      totalRevenue: number;
      totalContributionProfit: number;
      totalIncentiveCost: number;
    };
  };
  topOpenOpportunities: Array<{
    id: string;
    type: string;
    stage: string;
    cartValue: number | null;
    abandonedAt: Date | null;
    ageHours: number;
  }>;
  recentAttributions: Array<{
    opportunityType: string;
    revenue: number;
    contributionProfit: number;
    attributionType: string;
    attributedAt: Date;
  }>;
  activeExperiments: Array<{
    id: string;
    name: string;
    startedAt: Date | null;
  }>;
}

@Injectable()
export class RevenueContextService {
  private readonly logger = new Logger(RevenueContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: RevenueAttributionService,
  ) {}

  async build(): Promise<RevenueOptimizationContext> {
    const [openOpps, recentAttrs, activeExperiments, summary30] =
      await Promise.all([
        this.prisma.revenueOpportunity.findMany({
          where: { brandId: BRAND_ID, status: { in: ["NEW", "IN_JOURNEY"] } },
          orderBy: { abandonedAt: "asc" },
          take: 10,
          select: {
            id: true,
            type: true,
            stage: true,
            cartValue: true,
            abandonedAt: true,
          },
        }),
        this.prisma.revenueAttribution.findMany({
          where: {
            brandId: BRAND_ID,
            attributedAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
          include: { opportunity: { select: { type: true } } },
          orderBy: { attributedAt: "desc" },
          take: 20,
        }),
        this.prisma.revenueExperiment.findMany({
          where: { brandId: BRAND_ID, status: "ACTIVE" },
          select: { id: true, name: true, startedAt: true },
        }),
        this.attribution.getSummary(30),
      ]);

    const now = Date.now();
    const openByType: Record<string, number> = {};
    for (const opp of openOpps) {
      openByType[opp.type] = (openByType[opp.type] ?? 0) + 1;
    }

    return {
      summary: {
        openOpportunities: openOpps.length,
        openByType,
        last30Days: {
          recovered: summary30.totalAttributions,
          totalRevenue: summary30.totalRevenue,
          totalContributionProfit: summary30.totalContributionProfit,
          totalIncentiveCost: summary30.totalIncentiveCost,
        },
      },
      topOpenOpportunities: openOpps.map((o) => ({
        id: o.id,
        type: o.type,
        stage: o.stage,
        cartValue: o.cartValue,
        abandonedAt: o.abandonedAt,
        ageHours: o.abandonedAt
          ? Math.floor((now - o.abandonedAt.getTime()) / (1000 * 60 * 60))
          : 0,
      })),
      recentAttributions: recentAttrs.map((a) => ({
        opportunityType: a.opportunity.type,
        revenue: a.revenue ?? 0,
        contributionProfit: a.contributionProfit ?? 0,
        attributionType: a.attributionType,
        attributedAt: a.attributedAt,
      })),
      activeExperiments,
    };
  }
}
