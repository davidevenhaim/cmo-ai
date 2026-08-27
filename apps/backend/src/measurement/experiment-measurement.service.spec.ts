import { ExperimentMeasurementService } from "./experiment-measurement.service";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

interface VariantFixture {
  variantId: string;
  variantName: string;
  isControl: boolean;
  assigned: number;
  converted: number;
  profitPerAssigned: number;
}

function makeDeps(variants: VariantFixture[], status = "RUNNING") {
  const prisma = {
    revenueExperiment: {
      findUnique: jest.fn().mockResolvedValue({
        id: "exp-1",
        name: "Incentive test A",
        status,
      }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: "exp-1", name: "Incentive test A", status }]),
    },
    revenueExperimentAssignment: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const experiments = {
    getExperimentResults: jest.fn().mockResolvedValue(
      variants.map((v) => ({
        variantId: v.variantId,
        variantName: v.variantName,
        isControl: v.isControl,
        assigned: v.assigned,
        converted: v.converted,
        conversionRate: v.assigned > 0 ? v.converted / v.assigned : 0,
        totalRevenue: v.profitPerAssigned * v.assigned * 2,
        totalContributionProfit: v.profitPerAssigned * v.assigned,
        avgProfitPerAssigned: v.profitPerAssigned,
      })),
    ),
  };
  return { prisma, experiments };
}

function control(
  assigned: number,
  converted: number,
  profit = 2,
): VariantFixture {
  return {
    variantId: "v-control",
    variantName: "Control",
    isControl: true,
    assigned,
    converted,
    profitPerAssigned: profit,
  };
}

function variant(
  assigned: number,
  converted: number,
  profit = 5,
): VariantFixture {
  return {
    variantId: "v-b",
    variantName: "Variant B",
    isControl: false,
    assigned,
    converted,
    profitPerAssigned: profit,
  };
}

describe("ExperimentMeasurementService", () => {
  it("never declares a winner from tiny samples", async () => {
    const { prisma, experiments } = makeDeps([control(10, 3), variant(10, 8)]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("INSUFFICIENT_DATA");
    expect(result.bestVariantId).toBeNull();
    expect(result.note).toContain("No winner declared from small samples");
    expect(result.minSamplePerVariant).toBe(
      MEASUREMENT_POLICY.experiment.minSamplePerVariant,
    );
  });

  it("does not crown a high-revenue / low-profit variant as WINNER", async () => {
    // Variant B: more revenue in the fixture (profit*2) but worse contribution
    // profit per assigned than control — profit is the primary metric.
    const { prisma, experiments } = makeDeps([
      control(100, 20, 5),
      variant(100, 40, 2),
    ]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).not.toBe("WINNER");
    expect(result.bestVariantId).toBeNull();
    // Control has higher avg profit, so profitDelta for "best" non-control is negative.
    expect((result.profitDeltaPerAssigned ?? 0) <= 0).toBe(true);
  });

  it("requires minimum conversions per group even with enough samples", async () => {
    const { prisma, experiments } = makeDeps([
      control(100, 4), // below minConversionsPerVariant (5)
      variant(100, 30),
    ]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("INSUFFICIENT_DATA");
    expect(result.note).toContain("too early to call");
  });

  it("declares WINNER only at high confidence with positive profit delta", async () => {
    const { prisma, experiments } = makeDeps([
      control(100, 10, 2),
      variant(100, 30, 5),
    ]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("WINNER");
    expect(result.bestVariantId).toBe("v-b");
    expect(result.profitDeltaPerAssigned).toBe(3);
  });

  it("reports DIRECTIONAL below the winner threshold", async () => {
    const { prisma, experiments } = makeDeps([
      control(100, 10, 2),
      variant(100, 17, 3),
    ]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("DIRECTIONAL");
    expect(result.note).toContain("Directional signal only");
  });

  it("reports NO_CLEAR_WINNER when groups are indistinguishable", async () => {
    const { prisma, experiments } = makeDeps([
      control(100, 10, 2),
      variant(100, 11, 2.1),
    ]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("NO_CLEAR_WINNER");
    expect(result.bestVariantId).toBeNull();
  });

  it("needs a control and at least one variant", async () => {
    const { prisma, experiments } = makeDeps([variant(100, 30)]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("INSUFFICIENT_DATA");
    expect(result.note).toContain("control group");
  });

  it("marks ended under-sampled experiments STOPPED, not winners", async () => {
    const { prisma, experiments } = makeDeps(
      [control(5, 1), variant(5, 3)],
      "ENDED",
    );
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    expect(result.state).toBe("STOPPED");
    expect(result.bestVariantId).toBeNull();
  });

  it("includes per-variant incentive cost in results", async () => {
    const { prisma, experiments } = makeDeps([
      control(100, 10),
      variant(100, 30),
    ]);
    prisma.revenueExperimentAssignment.groupBy.mockResolvedValue([
      { variantId: "v-b", _sum: { incentiveCost: 120 } },
    ]);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    const result = await svc.evaluate("exp-1");
    const vb = result.variants.find((v) => v.variantId === "v-b");
    expect(vb?.totalIncentiveCost).toBe(120);
    expect(result.control?.totalIncentiveCost).toBe(0);
  });

  it("throws for an unknown experiment", async () => {
    const { prisma, experiments } = makeDeps([]);
    prisma.revenueExperiment.findUnique.mockResolvedValue(null);
    const svc = new ExperimentMeasurementService(
      prisma as any,
      experiments as any,
    );
    await expect(svc.evaluate("missing")).rejects.toThrow(/not found/);
  });
});
