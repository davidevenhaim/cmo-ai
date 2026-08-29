import { WhatsAppContextService } from "./whatsapp-context.service";

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    recoveryJourneyStep: {
      findMany: jest.fn().mockResolvedValue(overrides.steps ?? []),
    },
    revenueOpportunity: {
      findMany: jest.fn().mockResolvedValue(overrides.opportunities ?? []),
    },
    revenueAttribution: {
      findMany: jest.fn().mockResolvedValue(overrides.attributions ?? []),
    },
    whatsAppAutomation: {
      findMany: jest.fn().mockResolvedValue(overrides.automations ?? []),
    },
    abandonedCheckout: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.checkout === undefined
            ? { currencyCode: "ILS" }
            : overrides.checkout,
        ),
    },
    contact: {
      findFirst: jest.fn().mockResolvedValue(overrides.contact ?? null),
    },
  };
}

function makeSession(status = "WORKING", configured = true) {
  return {
    getConnection: jest.fn().mockResolvedValue({
      status,
      configured,
      sessionName: "default",
      meNumber: configured ? "972501234567" : null,
      meName: null,
      lastSyncAt: new Date(),
      lastQrAt: null,
      lastError: null,
    }),
  };
}

function step(overrides: Record<string, any> = {}) {
  return {
    stepNumber: 1,
    delayHours: 1,
    status: "SENT",
    skipReason: null,
    offerType: "NO_DISCOUNT",
    channel: "WHATSAPP",
    ...overrides,
  };
}

function makeService(prismaOverrides: Record<string, any> = {}, session = makeSession()) {
  const prisma = makePrisma(prismaOverrides);
  const service = new WhatsAppContextService(
    prisma as any,
    session as any,
    { getRevenueSync: jest.fn() } as any,
  );
  return { service, prisma };
}

describe("WhatsAppContextService", () => {
  describe("evidence status", () => {
    it("is NOT_CONFIGURED when WAHA is absent", async () => {
      const { service } = makeService({}, makeSession("NOT_CONFIGURED", false));
      const ctx = await service.build();
      expect(ctx.evidenceStatus).toBe("NOT_CONFIGURED");
    });

    it("is UNAVAILABLE when configured but disconnected", async () => {
      const { service } = makeService({}, makeSession("STOPPED", true));
      const ctx = await service.build();
      expect(ctx.evidenceStatus).toBe("UNAVAILABLE");
    });

    it("is AVAILABLE when the session is working", async () => {
      const { service } = makeService();
      const ctx = await service.build();
      expect(ctx.evidenceStatus).toBe("AVAILABLE");
    });
  });

  describe("currency (C3)", () => {
    it("uses the store's checkout currency", async () => {
      const { service } = makeService({ checkout: { currencyCode: "ILS" } });
      expect((await service.build()).currencyCode).toBe("ILS");
    });

    it("falls back to the contact currency when no checkout exists", async () => {
      const { service } = makeService({
        checkout: null,
        contact: { currencyCode: "EUR" },
      });
      expect((await service.build()).currencyCode).toBe("EUR");
    });

    it("falls back to USD only when nothing else is known", async () => {
      const { service } = makeService({ checkout: null, contact: null });
      expect((await service.build()).currencyCode).toBe("USD");
    });
  });

  describe("suppression buckets", () => {
    it("groups skip reasons into reportable buckets", async () => {
      const { service } = makeService({
        steps: [
          step({ status: "SKIPPED", skipReason: "NO_CONSENT" }),
          step({ status: "SKIPPED", skipReason: "UNSUBSCRIBED" }),
          step({ status: "SKIPPED", skipReason: "FREQUENCY_CAP" }),
          step({ status: "SKIPPED", skipReason: "PURCHASED" }),
          step({ status: "SKIPPED", skipReason: "INVALID_PHONE" }),
          step({ status: "SKIPPED", skipReason: "INVENTORY_UNAVAILABLE" }),
          step({ status: "SKIPPED", skipReason: "SOMETHING_ELSE" }),
        ],
      });

      const ctx = await service.build();

      expect(ctx.suppressed.noConsent).toBe(2);
      expect(ctx.suppressed.frequencyCap).toBe(1);
      expect(ctx.suppressed.purchasedBeforeSend).toBe(1);
      expect(ctx.suppressed.invalidPhone).toBe(1);
      expect(ctx.suppressed.inventoryUnavailable).toBe(1);
      expect(ctx.suppressed.other).toBe(1);
    });

    it("counts only sent steps as messages sent", async () => {
      const { service } = makeService({
        steps: [
          step({ status: "SENT" }),
          step({ status: "SENT" }),
          step({ status: "SKIPPED", skipReason: "NO_CONSENT" }),
          step({ status: "PENDING" }),
        ],
      });
      expect((await service.build()).abandonedCart.messagesSent).toBe(2);
    });

    it("ignores steps from non-WhatsApp channels", async () => {
      const { service } = makeService({
        steps: [step({ status: "SENT" }), step({ status: "SENT", channel: "EMAIL" })],
      });
      expect((await service.build()).abandonedCart.messagesSent).toBe(1);
    });
  });

  describe("ladder economics (Part E)", () => {
    it("groups sends and skips by ladder step", async () => {
      const { service } = makeService({
        steps: [
          step({ stepNumber: 1, delayHours: 1, status: "SENT" }),
          step({ stepNumber: 1, delayHours: 1, status: "SENT" }),
          step({
            stepNumber: 3,
            delayHours: 24,
            status: "SENT",
            offerType: "PERCENT_DISCOUNT",
          }),
          step({
            stepNumber: 3,
            delayHours: 24,
            status: "SKIPPED",
            skipReason: "FREQUENCY_CAP",
            offerType: "PERCENT_DISCOUNT",
          }),
        ],
      });

      const ctx = await service.build();

      expect(ctx.ladderSteps).toHaveLength(2);
      expect(ctx.ladderSteps[0]).toMatchObject({
        stepNumber: 1,
        sent: 2,
        skipped: 0,
      });
      expect(ctx.ladderSteps[1]).toMatchObject({
        stepNumber: 3,
        sent: 1,
        skipped: 1,
        offerType: "PERCENT_DISCOUNT",
      });
    });
  });

  describe("attribution is not incrementality", () => {
    it("sums attributed revenue and profit", async () => {
      const { service } = makeService({
        attributions: [
          { revenue: 1000, contributionProfit: 400, incentiveCost: 80 },
          { revenue: 420, contributionProfit: 110, incentiveCost: 20 },
        ],
      });

      const ctx = await service.build();

      expect(ctx.abandonedCart.attributedRevenue).toBe(1420);
      expect(ctx.abandonedCart.attributedProfit).toBe(510);
      expect(ctx.abandonedCart.incentiveCost).toBe(100);
    });

    it("exposes no field claiming incremental lift", async () => {
      const { service } = makeService();
      const ctx = await service.build();

      // Every money field is explicitly named "attributed".
      const keys = Object.keys(ctx.abandonedCart);
      expect(keys).toContain("attributedRevenue");
      expect(keys).toContain("attributedProfit");
      expect(keys.some((k) => /incremental/i.test(k))).toBe(false);
    });
  });

  describe("privacy", () => {
    it("carries no customer identifiers", async () => {
      const { service } = makeService({
        steps: [step()],
        opportunities: [{ id: "opp-1", status: "RECOVERED" }],
        attributions: [{ revenue: 100, contributionProfit: 30, incentiveCost: 5 }],
      });

      const serialized = JSON.stringify(await service.build());

      expect(serialized).not.toContain("972501234567");
      expect(serialized).not.toMatch(/@c\.us/);
      expect(serialized).not.toContain("contactId");
    });
  });

  describe("abandoned cart view (C6)", () => {
    it("labels the KPI block as attributed, not incremental", async () => {
      const prisma = makePrisma();
      (prisma.revenueOpportunity.findMany as jest.Mock).mockResolvedValue([]);
      const service = new WhatsAppContextService(
        prisma as any,
        makeSession() as any,
        { getRevenueSync: jest.fn() } as any,
      );

      const view = await service.getAbandonedCartView();

      expect(view.kpis.attributionNote).toContain("ATTRIBUTED");
      expect(view.kpis.attributionNote).toContain("not INCREMENTAL");
      expect(view.kpis.attributionNote).toContain("holdout");
    });

    it("returns a null recovery rate rather than dividing by zero", async () => {
      const prisma = makePrisma();
      (prisma.revenueOpportunity.findMany as jest.Mock).mockResolvedValue([]);
      const service = new WhatsAppContextService(
        prisma as any,
        makeSession() as any,
        { getRevenueSync: jest.fn() } as any,
      );

      const view = await service.getAbandonedCartView();
      expect(view.kpis.recoveryRate).toBeNull();
    });
  });
});
