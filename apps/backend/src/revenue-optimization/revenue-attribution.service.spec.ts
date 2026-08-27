import { RevenueAttributionService } from "./revenue-attribution.service";

const mockPrisma = {
  revenueAttribution: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  revenueOpportunity: {
    update: jest.fn(),
  },
};

describe("RevenueAttributionService", () => {
  let service: RevenueAttributionService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.revenueAttribution.create.mockResolvedValue({ id: "attr-1" });
    mockPrisma.revenueAttribution.findMany.mockResolvedValue([]);
    mockPrisma.revenueOpportunity.update.mockResolvedValue({});
    service = new RevenueAttributionService(mockPrisma as any);
  });

  describe("record", () => {
    it("returns attribution id", async () => {
      const id = await service.record({
        opportunityId: "opp-1",
        revenue: 100,
      });
      expect(id).toBe("attr-1");
    });

    it("computes contribution profit = revenue - incentiveCost - shippingSubsidy - cogs", async () => {
      await service.record({
        opportunityId: "opp-1",
        revenue: 100,
        incentiveCost: 10,
        shippingSubsidy: 5,
        estimatedCogs: 30,
      });
      const call = mockPrisma.revenueAttribution.create.mock.calls[0][0];
      expect(call.data.contributionProfit).toBeCloseTo(55);
    });

    it("sets attributionType ATTRIBUTED when no experiment", async () => {
      await service.record({ opportunityId: "opp-1", revenue: 100 });
      const call = mockPrisma.revenueAttribution.create.mock.calls[0][0];
      expect(call.data.attributionType).toBe("ATTRIBUTED");
    });

    it("sets attributionType INCREMENTAL_ESTIMATE when experiment provided", async () => {
      await service.record({
        opportunityId: "opp-1",
        revenue: 100,
        experimentId: "exp-1",
        variantId: "treat",
      });
      const call = mockPrisma.revenueAttribution.create.mock.calls[0][0];
      expect(call.data.attributionType).toBe("INCREMENTAL_ESTIMATE");
    });

    it("marks opportunity as RECOVERED", async () => {
      await service.record({
        opportunityId: "opp-1",
        revenue: 100,
        shopifyOrderId: "order-1",
      });
      expect(mockPrisma.revenueOpportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "opp-1" },
          data: expect.objectContaining({
            status: "RECOVERED",
            resultingOrderId: "order-1",
            recoveryValue: 100,
          }),
        }),
      );
    });

    it("computes grossMargin when cogs provided", async () => {
      await service.record({
        opportunityId: "opp-1",
        revenue: 100,
        estimatedCogs: 40,
      });
      const call = mockPrisma.revenueAttribution.create.mock.calls[0][0];
      expect(call.data.grossMargin).toBeCloseTo(0.6);
    });

    it("omits grossMargin when no cogs", async () => {
      await service.record({ opportunityId: "opp-1", revenue: 100 });
      const call = mockPrisma.revenueAttribution.create.mock.calls[0][0];
      expect(call.data.grossMargin).toBeNull();
    });
  });

  describe("getSummary", () => {
    it("aggregates totals across attributions", async () => {
      mockPrisma.revenueAttribution.findMany.mockResolvedValue([
        {
          revenue: 100,
          contributionProfit: 60,
          incentiveCost: 10,
          opportunity: { type: "CART_RECOVERY" },
        },
        {
          revenue: 200,
          contributionProfit: 130,
          incentiveCost: 20,
          opportunity: { type: "CART_RECOVERY" },
        },
      ]);

      const summary = await service.getSummary(30);
      expect(summary.totalRevenue).toBe(300);
      expect(summary.totalContributionProfit).toBe(190);
      expect(summary.totalIncentiveCost).toBe(30);
      expect(summary.totalAttributions).toBe(2);
      expect(summary.byType["CART_RECOVERY"].count).toBe(2);
    });

    it("returns zeros when no attributions", async () => {
      const summary = await service.getSummary(30);
      expect(summary.totalRevenue).toBe(0);
      expect(summary.totalAttributions).toBe(0);
    });

    it("splits ATTRIBUTED from INCREMENTAL_ESTIMATE — attributed revenue is not reported as incremental", async () => {
      mockPrisma.revenueAttribution.findMany.mockResolvedValue([
        {
          revenue: 100,
          contributionProfit: 60,
          incentiveCost: 10,
          attributionType: "ATTRIBUTED",
          opportunity: { type: "CART_RECOVERY" },
        },
        {
          revenue: 50,
          contributionProfit: 30,
          incentiveCost: 5,
          attributionType: "INCREMENTAL_ESTIMATE",
          opportunity: { type: "CART_RECOVERY" },
        },
      ]);

      const summary = await service.getSummary(30);
      expect(summary.byAttributionType["ATTRIBUTED"]).toEqual({
        count: 1,
        revenue: 100,
        profit: 60,
      });
      expect(summary.byAttributionType["INCREMENTAL_ESTIMATE"]).toEqual({
        count: 1,
        revenue: 50,
        profit: 30,
      });
    });
  });
});
