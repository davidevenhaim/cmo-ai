import { Injectable } from "@nestjs/common";
import { CmoScorecard } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { ShopifyService } from "../shopify/shopify.service";
import { RevenueAttributionService } from "../revenue-optimization/revenue-attribution.service";

const BRAND_ID = "luminesce-brand-001";

// CMO effectiveness = honest counts and rates over a window. There is no
// fake universal "AI score" — approval rate, execution rate, measurement
// coverage and outcome distribution stand on their own.
@Injectable()
export class CmoScorecardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly attribution: RevenueAttributionService,
  ) {}

  async generate(windowDays = 30, now = new Date()): Promise<CmoScorecard> {
    const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const recs = await this.prisma.recommendation.findMany({
      where: { brandId: BRAND_ID, createdAt: { gte: since } },
      select: { status: true, outcome: true, rejectionReason: true },
    });

    const count = (status: string) =>
      recs.filter((r) => r.status === status).length;
    const proposed = recs.length;
    const approved = count("APPROVED");
    const rejected = count("REJECTED");
    const executed = count("EXECUTED");
    const measuring = count("MEASURING");
    const measured = count("MEASURED");
    const expired = count("EXPIRED");
    const failed = count("FAILED");

    // FAILED and later stages imply an earlier approval/execution.
    const approvedTotal = approved + executed + measuring + measured + failed;
    const executedTotal = executed + measuring + measured + failed;
    const decided = approvedTotal + rejected;

    const outcomeOf = (o: string) => recs.filter((r) => r.outcome === o).length;

    const rejectionReasons: Record<string, number> = {};
    for (const r of recs) {
      if (r.status === "REJECTED") {
        const reason = r.rejectionReason ?? "UNSPECIFIED";
        rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
      }
    }

    const summary = await this.attribution.getSummary(windowDays);
    const snapshot = await this.shopify.getLatestSnapshot();

    return {
      generatedAt: now,
      windowDays,
      proposed,
      approved,
      rejected,
      executed,
      measuring,
      measured,
      expired,
      failed,
      approvalRate: decided > 0 ? round2(approvedTotal / decided) : null,
      executionRate:
        approvedTotal > 0 ? round2(executedTotal / approvedTotal) : null,
      measurementCoverage:
        executedTotal > 0 ? round2(measured / executedTotal) : null,
      outcomes: {
        outperformed: outcomeOf("OUTPERFORMED"),
        expected: outcomeOf("EXPECTED"),
        underperformed: outcomeOf("UNDERPERFORMED"),
        inconclusive: outcomeOf("INCONCLUSIVE"),
      },
      rejectionReasons,
      currencyCode: snapshot?.metrics?.currencyCode ?? null,
      // Last-touch attributed profit — correlational, never claimed as caused.
      attributedValue: summary.byAttributionType["ATTRIBUTED"]?.profit ?? 0,
      // Experiment-backed incremental profit — the only causal claim allowed.
      experimentBackedIncrementalValue:
        summary.byAttributionType["INCREMENTAL_ESTIMATE"]?.profit ?? 0,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
