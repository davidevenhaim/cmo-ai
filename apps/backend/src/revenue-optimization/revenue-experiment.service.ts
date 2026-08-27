import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export interface ExperimentVariant {
  id: string;
  name: string;
  discountPct?: number;
  offerType?: string;
  isControl?: boolean;
  weight: number;
}

@Injectable()
export class RevenueExperimentService {
  private readonly logger = new Logger(RevenueExperimentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createExperiment(
    name: string,
    variants: ExperimentVariant[],
    description?: string,
  ): Promise<string> {
    const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
    if (Math.abs(totalWeight - 1) > 0.01) {
      throw new Error(`Variant weights must sum to 1.0, got ${totalWeight}`);
    }

    const experiment = await this.prisma.revenueExperiment.create({
      data: {
        brandId: BRAND_ID,
        name,
        description,
        variants: variants as any,
        status: "ACTIVE",
        startedAt: new Date(),
      },
    });

    this.logger.log(`Created experiment ${experiment.id}: ${name}`);
    return experiment.id;
  }

  async assignVariant(
    experimentId: string,
    customerId: string,
  ): Promise<ExperimentVariant | null> {
    const experiment = await this.prisma.revenueExperiment.findUnique({
      where: { id: experimentId },
    });

    if (!experiment || experiment.status !== "ACTIVE") return null;

    const existing = await this.prisma.revenueExperimentAssignment.findUnique({
      where: { experimentId_customerId: { experimentId, customerId } },
    });

    if (existing) {
      const variants = experiment.variants as unknown as ExperimentVariant[];
      return variants.find((v) => v.id === existing.variantId) ?? null;
    }

    const variants = experiment.variants as unknown as ExperimentVariant[];
    const variant = this._pickVariant(variants);

    await this.prisma.revenueExperimentAssignment.create({
      data: {
        experimentId,
        customerId,
        variantId: variant.id,
        variantName: variant.name,
        isControl: variant.isControl ?? false,
      },
    });

    return variant;
  }

  async recordConversion(
    experimentId: string,
    customerId: string,
    revenue: number,
    incentiveCost: number,
    estimatedCogs?: number,
  ): Promise<void> {
    const contributionProfit =
      estimatedCogs !== undefined
        ? revenue - incentiveCost - estimatedCogs
        : revenue - incentiveCost;

    await this.prisma.revenueExperimentAssignment.updateMany({
      where: { experimentId, customerId, convertedAt: null },
      data: {
        convertedAt: new Date(),
        revenue,
        incentiveCost,
        contributionProfit,
      },
    });
  }

  async getExperimentResults(experimentId: string) {
    const assignments = await this.prisma.revenueExperimentAssignment.findMany({
      where: { experimentId },
    });

    const byVariant = new Map<
      string,
      { name: string; isControl: boolean; assignments: typeof assignments }
    >();

    for (const a of assignments) {
      if (!byVariant.has(a.variantId)) {
        byVariant.set(a.variantId, {
          name: a.variantName,
          isControl: a.isControl,
          assignments: [],
        });
      }
      byVariant.get(a.variantId)!.assignments.push(a);
    }

    return Array.from(byVariant.entries()).map(([variantId, v]) => {
      const converted = v.assignments.filter((a) => a.convertedAt !== null);
      const totalProfit = converted.reduce(
        (s, a) => s + (a.contributionProfit ?? 0),
        0,
      );
      const totalRevenue = converted.reduce((s, a) => s + (a.revenue ?? 0), 0);
      return {
        variantId,
        variantName: v.name,
        isControl: v.isControl,
        assigned: v.assignments.length,
        converted: converted.length,
        conversionRate:
          v.assignments.length > 0
            ? converted.length / v.assignments.length
            : 0,
        totalRevenue,
        totalContributionProfit: totalProfit,
        avgProfitPerAssigned:
          v.assignments.length > 0 ? totalProfit / v.assignments.length : 0,
      };
    });
  }

  async endExperiment(experimentId: string): Promise<void> {
    await this.prisma.revenueExperiment.update({
      where: { id: experimentId },
      data: { status: "ENDED", endedAt: new Date() },
    });
  }

  private _pickVariant(variants: ExperimentVariant[]): ExperimentVariant {
    const rand = Math.random();
    let cumulative = 0;
    for (const v of variants) {
      cumulative += v.weight;
      if (rand < cumulative) return v;
    }
    return variants[variants.length - 1];
  }
}
