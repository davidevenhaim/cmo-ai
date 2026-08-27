import { Controller, Get, Post, Logger } from "@nestjs/common";
import { MarketIntelligenceSyncService } from "./market-intelligence-sync.service";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

@Controller("market-intelligence")
export class MarketIntelligenceController {
  private readonly logger = new Logger(MarketIntelligenceController.name);

  constructor(
    private readonly sync: MarketIntelligenceSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("status")
  status() {
    return this.sync.getStatus();
  }

  @Post("sync")
  triggerSync() {
    // Fire and forget — returns immediately
    setImmediate(() => {
      this.sync
        .runSync("api")
        .catch((err) =>
          this.logger.error(`Market intelligence sync failed: ${err.message}`),
        );
    });
    return { started: true };
  }

  @Get("opportunities")
  opportunities() {
    return this.prisma.marketOpportunity.findMany({
      where: { brandId: BRAND_ID, status: "NEW" },
      orderBy: { score: "desc" },
      take: 20,
    });
  }

  @Get("search-opportunities")
  searchOpportunities() {
    return this.prisma.searchOpportunity.findMany({
      where: { brandId: BRAND_ID, status: "NEW" },
      include: { keyword: true },
      orderBy: { score: "desc" },
      take: 20,
    });
  }

  @Get("keywords")
  keywords() {
    return this.prisma.keyword.findMany({
      where: { brandId: BRAND_ID, active: true },
      include: {
        metrics: { orderBy: { fetchedAt: "desc" }, take: 1 },
      },
      orderBy: { relevance: "desc" },
      take: 50,
    });
  }

  @Get("funnel")
  funnel() {
    return this.prisma.productFunnelMetric.findMany({
      where: { brandId: BRAND_ID },
      orderBy: [{ period: "desc" }, { revenue: "desc" }],
      take: 30,
    });
  }

  @Get("onsite-searches")
  onsiteSearches() {
    return this.prisma.onsiteSearchMetric.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { count: "desc" },
      take: 50,
    });
  }

  @Get("questions")
  questions() {
    return this.prisma.questionSignal.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { frequency: "desc" },
      take: 30,
    });
  }

  @Get("audience-language")
  audienceLanguage() {
    return this.prisma.audienceLanguageSignal.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { frequency: "desc" },
      take: 30,
    });
  }
}
