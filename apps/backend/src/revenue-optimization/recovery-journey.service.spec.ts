import { RecoveryJourneyService } from "./recovery-journey.service";
import { OfferPolicyEngine } from "./offer-policy-engine.service";

const mockPrisma = {
  recoveryJourney: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  recoveryJourneyStep: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  revenueOpportunity: {
    findUnique: jest.fn(),
  },
  abandonedCheckout: {
    findUnique: jest.fn(),
  },
  customerRevenueAction: {
    create: jest.fn(),
  },
  campaignTouch: {
    create: jest.fn(),
  },
  contact: {
    findUnique: jest.fn(),
  },
  contactSuppression: {
    findFirst: jest.fn(),
  },
  commerceSnapshot: {
    findFirst: jest.fn(),
  },
};

const mockMessaging = {
  isConfigured: jest.fn(),
  send: jest.fn(),
};

const mockFrequencyCaps = {
  isEligible: jest.fn(),
};

const realOfferPolicy = new OfferPolicyEngine();

function makeStep(oppOverrides: Record<string, unknown> = {}) {
  return {
    id: "step-1",
    journeyId: "journey-1",
    channel: "WHATSAPP",
    offerType: "NO_DISCOUNT",
    offerValue: null,
    stepNumber: 1,
    journey: {
      opportunity: {
        id: "opp-1",
        status: "NEW",
        contactId: "c-1",
        abandonedCheckoutId: null,
        abandonedAt: null,
        products: [],
        cartValue: 80,
        recoveryUrl: "http://shop.example/recover",
        ...oppOverrides,
      },
    },
  };
}

describe("RecoveryJourneyService", () => {
  let service: RecoveryJourneyService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockPrisma.recoveryJourney.findUnique.mockResolvedValue(null);
    mockPrisma.recoveryJourney.findFirst.mockResolvedValue(null);
    mockPrisma.recoveryJourney.create.mockResolvedValue({ id: "journey-1" });
    mockPrisma.recoveryJourney.update.mockResolvedValue({});
    mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([]);
    mockPrisma.recoveryJourneyStep.update.mockResolvedValue({});
    mockPrisma.recoveryJourneyStep.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.revenueOpportunity.findUnique.mockResolvedValue({
      contactId: "c-1",
      products: [],
    });
    mockPrisma.abandonedCheckout.findUnique.mockResolvedValue(null);
    mockPrisma.customerRevenueAction.create.mockResolvedValue({});
    mockPrisma.campaignTouch.create.mockResolvedValue({});
    mockPrisma.contact.findUnique.mockResolvedValue({
      phone: "+1555000000",
      smsMarketingStatus: "SUBSCRIBED",
      lastOrderAt: null,
      currencyCode: "USD",
    });
    mockPrisma.contactSuppression.findFirst.mockResolvedValue(null);
    mockPrisma.commerceSnapshot.findFirst.mockResolvedValue(null);
    mockMessaging.isConfigured.mockReturnValue(true);
    mockMessaging.send.mockResolvedValue({
      success: true,
      providerMessageId: "msg-1",
    });
    mockFrequencyCaps.isEligible.mockResolvedValue(true);

    service = new RecoveryJourneyService(
      mockPrisma as any,
      mockMessaging as any,
      realOfferPolicy,
      mockFrequencyCaps as any,
    );
  });

  function lastStepUpdate() {
    const calls = mockPrisma.recoveryJourneyStep.update.mock.calls;
    return calls[calls.length - 1][0];
  }

  describe("startJourney", () => {
    it("creates a journey with 4 steps", async () => {
      const id = await service.startJourney("opp-1", { cartValue: 80 });
      expect(id).toBe("journey-1");
      const createCall = mockPrisma.recoveryJourney.create.mock.calls[0][0];
      expect(createCall.data.steps.create).toHaveLength(4);
    });

    it("returns existing journey id without creating duplicate", async () => {
      mockPrisma.recoveryJourney.findUnique.mockResolvedValue({
        id: "existing-journey",
      });
      const id = await service.startJourney("opp-1", { cartValue: 80 });
      expect(id).toBe("existing-journey");
      expect(mockPrisma.recoveryJourney.create).not.toHaveBeenCalled();
    });

    it("does not start a second simultaneous journey for the same contact", async () => {
      mockPrisma.recoveryJourney.findFirst.mockResolvedValue({
        id: "active-journey-other-opp",
      });
      const id = await service.startJourney("opp-2", { cartValue: 80 });
      expect(id).toBe("active-journey-other-opp");
      expect(mockPrisma.recoveryJourney.create).not.toHaveBeenCalled();
    });

    it("schedules steps at correct delay hours", async () => {
      await service.startJourney("opp-1", { cartValue: 80 });
      const steps =
        mockPrisma.recoveryJourney.create.mock.calls[0][0].data.steps.create;
      expect(steps[0].delayHours).toBe(1);
      expect(steps[1].delayHours).toBe(6);
      expect(steps[2].delayHours).toBe(24);
      expect(steps[3].delayHours).toBe(48);
    });

    it("assigns offer types from policy engine", async () => {
      await service.startJourney("opp-1", {
        cartValue: 80,
        estimatedMarginPct: 0.5,
      });
      const steps =
        mockPrisma.recoveryJourney.create.mock.calls[0][0].data.steps.create;
      // Step at 1h → NO_DISCOUNT (too early)
      expect(steps[0].offerType).toBe("NO_DISCOUNT");
      // Step at 24h → PERCENT_DISCOUNT 10%
      expect(steps[2].offerType).toBe("PERCENT_DISCOUNT");
    });

    it("suppresses all offers when cart inventory is unavailable", async () => {
      mockPrisma.revenueOpportunity.findUnique.mockResolvedValue({
        contactId: "c-1",
        products: [{ shopifyProductId: "p1", quantity: 1 }],
      });
      mockPrisma.commerceSnapshot.findFirst.mockResolvedValue({
        available: true,
        metricsJson: {
          lowInventoryProducts: [{ productId: "p1", totalUnits: 0 }],
        },
      });

      await service.startJourney("opp-1", {
        cartValue: 80,
        estimatedMarginPct: 0.5,
      });
      const steps =
        mockPrisma.recoveryJourney.create.mock.calls[0][0].data.steps.create;
      for (const s of steps) {
        expect(s.offerType).toBe("NO_OFFER");
      }
    });
  });

  describe("processAllDueSteps", () => {
    it("returns 0 when no due steps", async () => {
      const count = await service.processAllDueSteps();
      expect(count).toBe(0);
    });

    it("skips step as PURCHASED when opportunity is RECOVERED", async () => {
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([
        makeStep({ status: "RECOVERED" }),
      ]);

      const count = await service.processAllDueSteps();
      expect(count).toBe(1);
      expect(lastStepUpdate().data).toEqual(
        expect.objectContaining({ status: "SKIPPED", skipReason: "PURCHASED" }),
      );
      expect(mockMessaging.send).not.toHaveBeenCalled();
    });

    it("skips step with INVALID_PHONE when no phone on file", async () => {
      mockPrisma.contact.findUnique.mockResolvedValue({
        phone: null,
        smsMarketingStatus: "SUBSCRIBED",
        lastOrderAt: null,
        currencyCode: "USD",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("INVALID_PHONE");
    });

    it("does not send without consent (NOT_SUBSCRIBED → NO_CONSENT)", async () => {
      mockPrisma.contact.findUnique.mockResolvedValue({
        phone: "+1555000000",
        smsMarketingStatus: "NOT_SUBSCRIBED",
        lastOrderAt: null,
        currencyCode: "USD",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data).toEqual(
        expect.objectContaining({
          status: "SKIPPED",
          skipReason: "NO_CONSENT",
        }),
      );
    });

    it("does not send when unsubscribed", async () => {
      mockPrisma.contact.findUnique.mockResolvedValue({
        phone: "+1555000000",
        smsMarketingStatus: "UNSUBSCRIBED",
        lastOrderAt: null,
        currencyCode: "USD",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("UNSUBSCRIBED");
    });

    it("fails closed on unknown consent status", async () => {
      mockPrisma.contact.findUnique.mockResolvedValue({
        phone: "+1555000000",
        smsMarketingStatus: "PENDING",
        lastOrderAt: null,
        currencyCode: "USD",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("UNKNOWN_CONSENT");
    });

    it("does not send when frequency cap exceeded", async () => {
      mockFrequencyCaps.isEligible.mockResolvedValue(false);
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("FREQUENCY_CAP");
      expect(mockFrequencyCaps.isEligible).toHaveBeenCalledWith(
        "c-1",
        "CART_RECOVERY",
      );
    });

    it("does not send when an active suppression exists", async () => {
      mockPrisma.contactSuppression.findFirst.mockResolvedValue({
        reason: "PURCHASE_COMPLETED",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("PURCHASED");
    });

    it("only one concurrent executor sends — claim loser does nothing", async () => {
      mockPrisma.recoveryJourneyStep.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      const count = await service.processAllDueSteps();
      expect(count).toBe(0);
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(mockPrisma.recoveryJourneyStep.update).not.toHaveBeenCalled();
    });

    it("claims step atomically PENDING → EXECUTING before sending", async () => {
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(mockPrisma.recoveryJourneyStep.updateMany).toHaveBeenCalledWith({
        where: { id: "step-1", status: "PENDING" },
        data: { status: "EXECUTING" },
      });
    });

    it("suppresses send and stops journey when checkout already recovered", async () => {
      mockPrisma.abandonedCheckout.findUnique.mockResolvedValue({
        status: "RECOVERED",
        recoveredAt: new Date(),
        currencyCode: "USD",
      });
      mockPrisma.recoveryJourney.findUnique.mockResolvedValue({
        id: "journey-1",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([
        makeStep({ abandonedCheckoutId: "chk-1" }),
      ]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("PURCHASED");
      expect(mockPrisma.recoveryJourney.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "STOPPED" }),
        }),
      );
    });

    it("suppresses send when contact ordered after abandonment", async () => {
      const abandonedAt = new Date("2026-08-01T00:00:00Z");
      mockPrisma.contact.findUnique.mockResolvedValue({
        phone: "+1555000000",
        smsMarketingStatus: "SUBSCRIBED",
        lastOrderAt: new Date("2026-08-02T00:00:00Z"),
        currencyCode: "USD",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([
        makeStep({ abandonedAt }),
      ]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("PURCHASED");
    });

    it("suppresses send when all cart items are out of stock", async () => {
      mockPrisma.commerceSnapshot.findFirst.mockResolvedValue({
        available: true,
        metricsJson: {
          lowInventoryProducts: [{ productId: "p1", totalUnits: 0 }],
        },
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([
        makeStep({ products: [{ shopifyProductId: "p1", quantity: 2 }] }),
      ]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate().data.skipReason).toBe("INVENTORY_UNAVAILABLE");
    });

    it("downgrades offer to plain reminder when part of cart is out of stock", async () => {
      mockPrisma.commerceSnapshot.findFirst.mockResolvedValue({
        available: true,
        metricsJson: {
          lowInventoryProducts: [{ productId: "p1", totalUnits: 0 }],
        },
      });
      const step = makeStep({
        products: [
          { shopifyProductId: "p1", quantity: 1 },
          { shopifyProductId: "p2", quantity: 1 },
        ],
      });
      step.offerType = "PERCENT_DISCOUNT";
      step.offerValue = 10 as any;
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([step]);

      await service.processAllDueSteps();
      expect(mockMessaging.send).toHaveBeenCalled();
      const body = mockMessaging.send.mock.calls[0][0].body;
      expect(body).not.toContain("%");
      expect(body).toContain("waiting in your cart");
    });

    it("uses checkout currency instead of hardcoded dollars", async () => {
      mockPrisma.abandonedCheckout.findUnique.mockResolvedValue({
        status: "ACTIVE",
        recoveredAt: null,
        currencyCode: "EUR",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([
        makeStep({ abandonedCheckoutId: "chk-1" }),
      ]);

      await service.processAllDueSteps();
      const body = mockMessaging.send.mock.calls[0][0].body;
      expect(body).toContain("€");
      expect(body).not.toContain("$");
    });

    it("sends message, logs action, and records a SEND campaign touch", async () => {
      const step = makeStep();
      step.offerType = "PERCENT_DISCOUNT";
      step.offerValue = 10 as any;
      step.stepNumber = 3;
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([step]);

      const count = await service.processAllDueSteps();
      expect(count).toBe(1);
      expect(mockMessaging.send).toHaveBeenCalled();
      const sentBody = mockMessaging.send.mock.calls[0][0].body;
      expect(sentBody).toContain("10%");
      expect(mockPrisma.customerRevenueAction.create).toHaveBeenCalled();
      expect(mockPrisma.campaignTouch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactId: "c-1",
            touchType: "SEND",
          }),
        }),
      );
    });

    it("marks step FAILED on confirmed send failure without recording a touch", async () => {
      mockMessaging.send.mockResolvedValue({
        success: false,
        error: "rejected",
        outcome: "FAILED",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(lastStepUpdate().data.status).toBe("FAILED");
      expect(mockPrisma.campaignTouch.create).not.toHaveBeenCalled();
      expect(mockPrisma.customerRevenueAction.create).not.toHaveBeenCalled();
    });

    it("marks step UNKNOWN when send outcome is unverified", async () => {
      mockMessaging.send.mockResolvedValue({
        success: false,
        error: "timeout",
        outcome: "UNKNOWN",
      });
      mockPrisma.recoveryJourneyStep.findMany.mockResolvedValue([makeStep()]);

      await service.processAllDueSteps();
      expect(lastStepUpdate().data.status).toBe("UNKNOWN");
      expect(mockPrisma.campaignTouch.create).not.toHaveBeenCalled();
    });
  });

  describe("stopJourney", () => {
    it("stops journey and cancels pending steps", async () => {
      mockPrisma.recoveryJourney.findUnique.mockResolvedValue({
        id: "journey-1",
      });
      await service.stopJourney("opp-1", "RECOVERED");
      expect(mockPrisma.recoveryJourney.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "STOPPED",
            stopReason: "RECOVERED",
          }),
        }),
      );
      expect(mockPrisma.recoveryJourneyStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "CANCELLED" }),
        }),
      );
    });

    it("does nothing when journey does not exist", async () => {
      await service.stopJourney("opp-no-journey", "RECOVERED");
      expect(mockPrisma.recoveryJourney.update).not.toHaveBeenCalled();
    });
  });
});
