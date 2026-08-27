import { RevenueExperimentService } from "./revenue-experiment.service";

const mockPrisma = {
  revenueExperiment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  revenueExperimentAssignment: {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
};

const variants = [
  { id: "control", name: "Control", isControl: true, weight: 0.5 },
  { id: "treat", name: "Treatment 10%", discountPct: 10, weight: 0.5 },
];

describe("RevenueExperimentService", () => {
  let service: RevenueExperimentService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.revenueExperiment.create.mockResolvedValue({ id: "exp-1" });
    mockPrisma.revenueExperiment.findUnique.mockResolvedValue(null);
    mockPrisma.revenueExperimentAssignment.findUnique.mockResolvedValue(null);
    mockPrisma.revenueExperimentAssignment.create.mockResolvedValue({});
    mockPrisma.revenueExperimentAssignment.updateMany.mockResolvedValue({});
    mockPrisma.revenueExperimentAssignment.findMany.mockResolvedValue([]);
    service = new RevenueExperimentService(mockPrisma as any);
  });

  describe("createExperiment", () => {
    it("creates experiment and returns id", async () => {
      const id = await service.createExperiment("Test", variants);
      expect(id).toBe("exp-1");
      expect(mockPrisma.revenueExperiment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Test", status: "ACTIVE" }),
        }),
      );
    });

    it("throws when variant weights do not sum to 1", async () => {
      const bad = [
        { id: "a", name: "A", weight: 0.3 },
        { id: "b", name: "B", weight: 0.3 },
      ];
      await expect(service.createExperiment("Bad", bad)).rejects.toThrow(
        "weights must sum to 1",
      );
    });
  });

  describe("assignVariant", () => {
    it("returns null for non-existent or inactive experiment", async () => {
      mockPrisma.revenueExperiment.findUnique.mockResolvedValue(null);
      const result = await service.assignVariant("exp-1", "cust-1");
      expect(result).toBeNull();
    });

    it("assigns a variant to a new customer", async () => {
      mockPrisma.revenueExperiment.findUnique.mockResolvedValue({
        id: "exp-1",
        status: "ACTIVE",
        variants,
      });
      const result = await service.assignVariant("exp-1", "cust-1");
      expect(result).not.toBeNull();
      expect(["control", "treat"]).toContain(result!.id);
    });

    it("returns same variant for already-assigned customer", async () => {
      mockPrisma.revenueExperiment.findUnique.mockResolvedValue({
        id: "exp-1",
        status: "ACTIVE",
        variants,
      });
      mockPrisma.revenueExperimentAssignment.findUnique.mockResolvedValue({
        variantId: "control",
      });
      const result = await service.assignVariant("exp-1", "cust-1");
      expect(result!.id).toBe("control");
      expect(
        mockPrisma.revenueExperimentAssignment.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe("recordConversion", () => {
    it("records contribution profit = revenue - incentiveCost - cogs", async () => {
      await service.recordConversion("exp-1", "cust-1", 100, 10, 30);
      expect(
        mockPrisma.revenueExperimentAssignment.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revenue: 100,
            incentiveCost: 10,
            contributionProfit: 60,
          }),
        }),
      );
    });

    it("uses revenue - incentiveCost when no cogs provided", async () => {
      await service.recordConversion("exp-1", "cust-1", 100, 15);
      expect(
        mockPrisma.revenueExperimentAssignment.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contributionProfit: 85 }),
        }),
      );
    });
  });

  describe("getExperimentResults", () => {
    it("aggregates conversion rate and contribution profit by variant", async () => {
      mockPrisma.revenueExperimentAssignment.findMany.mockResolvedValue([
        {
          variantId: "control",
          variantName: "Control",
          isControl: true,
          convertedAt: new Date(),
          revenue: 100,
          incentiveCost: 0,
          contributionProfit: 70,
        },
        {
          variantId: "control",
          variantName: "Control",
          isControl: true,
          convertedAt: null,
          revenue: null,
          incentiveCost: null,
          contributionProfit: null,
        },
      ]);

      const results = await service.getExperimentResults("exp-1");
      const control = results.find((r) => r.variantId === "control")!;
      expect(control.assigned).toBe(2);
      expect(control.converted).toBe(1);
      expect(control.conversionRate).toBe(0.5);
      expect(control.totalContributionProfit).toBe(70);
    });
  });
});
