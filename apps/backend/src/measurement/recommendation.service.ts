import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EvidenceRef, RejectionReason, ValueUnit } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

const BRAND_ID = "luminesce-brand-001";

export interface ProposeRecommendationInput {
  type: string;
  title: string;
  rationale: string;
  evidenceRefs?: EvidenceRef[];
  confidence: number;
  expectedImpact?: string | null;
  expectedImpactValue?: number | null;
  expectedImpactUnit?: ValueUnit | null;
  targetType?: string | null;
  targetId?: string | null;
  actionClass: "READ" | "PROPOSE" | "MUTATE" | "EXECUTE";
  measurementWindowDays?: number;
}

// Unified Recommendation domain. Persists important CMO recommendations and
// preserves lineage to the entities they created (ContentBrief,
// RevenueOpportunity, ...) — it links to them, never replaces them.
@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Idempotent: re-proposing the same (type, target) while a prior proposal
  // is still open returns the existing recommendation instead of duplicating.
  async propose(input: ProposeRecommendationInput) {
    const dedupeKey = `${input.type}:${input.targetType ?? "-"}:${input.targetId ?? "-"}`;
    const existing = await this.prisma.recommendation.findFirst({
      where: {
        brandId: BRAND_ID,
        dedupeKey,
        status: { in: ["PROPOSED", "APPROVED", "EXECUTED", "MEASURING"] },
      },
    });
    if (existing) return existing;

    return this.prisma.recommendation.create({
      data: {
        brandId: BRAND_ID,
        type: input.type,
        title: input.title,
        rationale: input.rationale,
        evidenceRefs: (input.evidenceRefs ?? []) as unknown as object,
        confidence: input.confidence,
        expectedImpact: input.expectedImpact ?? null,
        expectedImpactValue: input.expectedImpactValue ?? null,
        expectedImpactUnit: input.expectedImpactUnit ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        actionClass: input.actionClass,
        measurementWindowDays:
          input.measurementWindowDays ?? MEASUREMENT_POLICY.defaultWindowDays,
        dedupeKey,
      },
    });
  }

  // Owner decision. Rejection is data too — the structured reason is optional
  // but retained for future learning (M10). Nothing is deleted.
  async decide(
    id: string,
    decision: {
      status: "APPROVED" | "REJECTED";
      rejectionReason?: RejectionReason;
      rejectionNote?: string;
    },
  ) {
    const rec = await this.prisma.recommendation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException(`Recommendation ${id} not found`);
    if (rec.status !== "PROPOSED") {
      throw new Error(
        `Recommendation ${id} is ${rec.status} — only PROPOSED recommendations can be decided`,
      );
    }
    return this.prisma.recommendation.update({
      where: { id },
      data: {
        status: decision.status,
        decidedAt: new Date(),
        rejectionReason:
          decision.status === "REJECTED"
            ? (decision.rejectionReason ?? null)
            : null,
        rejectionNote:
          decision.status === "REJECTED"
            ? (decision.rejectionNote ?? null)
            : null,
      },
    });
  }

  // Execution starts the measurement clock. Acting on a PROPOSED
  // recommendation through normal flows counts as an implicit approval.
  async markExecuted(id: string, executedAt = new Date()) {
    const rec = await this.prisma.recommendation.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException(`Recommendation ${id} not found`);
    if (!["PROPOSED", "APPROVED"].includes(rec.status)) return rec;
    return this.prisma.recommendation.update({
      where: { id },
      data: {
        status: "EXECUTED",
        decidedAt: rec.decidedAt ?? executedAt,
        executedAt,
        measurementWindowEndsAt: new Date(
          executedAt.getTime() +
            rec.measurementWindowDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
  }

  async markFailed(id: string, reason: string) {
    return this.prisma.recommendation.update({
      where: { id },
      data: { status: "FAILED", outcomeSummary: reason },
    });
  }

  // Stale open proposals expire — retained as history, never deleted.
  async expireStale(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - MEASUREMENT_POLICY.proposalTtlDays * 24 * 60 * 60 * 1000,
    );
    const result = await this.prisma.recommendation.updateMany({
      where: {
        brandId: BRAND_ID,
        status: "PROPOSED",
        createdAt: { lt: cutoff },
      },
      data: { status: "EXPIRED" },
    });
    return result.count;
  }

  // Deterministic execution detection through lineage: a recommendation whose
  // linked brief now has a live publication (or whose linked revenue
  // opportunity has an active journey) has been executed. Idempotent.
  async syncExecutionTransitions(): Promise<number> {
    const open = await this.prisma.recommendation.findMany({
      where: {
        brandId: BRAND_ID,
        status: { in: ["PROPOSED", "APPROVED"] },
      },
      include: {
        contentBriefs: {
          include: {
            drafts: {
              include: {
                publishRequests: { include: { publication: true } },
              },
            },
          },
        },
        revenueOpportunities: { include: { journey: true } },
      },
    });

    let transitioned = 0;
    for (const rec of open) {
      const livePublication = rec.contentBriefs
        .flatMap((b) => b.drafts)
        .flatMap((d) => d.publishRequests)
        .map((r) => r.publication)
        .find((p) => p && p.status === "LIVE");
      if (livePublication) {
        await this.markExecuted(
          rec.id,
          livePublication.publishedAt ?? new Date(),
        );
        transitioned++;
        continue;
      }
      const startedJourney = rec.revenueOpportunities.find(
        (o) => o.journey !== null,
      );
      if (startedJourney) {
        await this.markExecuted(
          rec.id,
          startedJourney.journey!.createdAt ?? new Date(),
        );
        transitioned++;
      }
    }
    return transitioned;
  }

  async list(filter?: { status?: string; limit?: number }) {
    return this.prisma.recommendation.findMany({
      where: {
        brandId: BRAND_ID,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filter?.limit ?? 100,
    });
  }

  // Full lineage for the detail timeline:
  // signal → recommendation → decision → execution → measurement → outcome.
  async getDetail(id: string) {
    const rec = await this.prisma.recommendation.findUnique({
      where: { id },
      include: {
        outcomeMetrics: { orderBy: { observedAt: "asc" } },
        contentBriefs: {
          include: {
            drafts: {
              include: {
                publishRequests: { include: { publication: true } },
              },
            },
          },
        },
        revenueOpportunities: {
          include: { journey: true, attributions: true },
        },
      },
    });
    if (!rec) throw new NotFoundException(`Recommendation ${id} not found`);
    return rec;
  }

  async linkContentBrief(recommendationId: string, briefId: string) {
    await this.prisma.contentBrief.update({
      where: { id: briefId },
      data: { recommendationId },
    });
  }

  async linkRevenueOpportunity(
    recommendationId: string,
    opportunityId: string,
  ) {
    await this.prisma.revenueOpportunity.update({
      where: { id: opportunityId },
      data: { recommendationId },
    });
  }
}
