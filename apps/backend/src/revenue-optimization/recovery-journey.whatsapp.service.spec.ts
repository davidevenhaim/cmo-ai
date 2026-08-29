import { RecoveryJourneyService } from "./recovery-journey.service";
import { OfferPolicyEngine } from "./offer-policy-engine.service";
import { CODE_REVENUE_DEFAULTS } from "../settings/settings.defaults";
import { WhatsAppTemplateService } from "../whatsapp/whatsapp-template.service";

/**
 * M9.6 Part C — the abandoned-cart WhatsApp path.
 *
 * The existing recovery-journey spec covers the pre-M9.6 gates; this suite
 * covers what M9.6 added: automation modes, template rendering, currency
 * propagation and inbox mirroring, plus the safety invariants those must not
 * weaken.
 */

const TEMPLATES = {
  reminder: {
    id: "tpl-reminder",
    key: "abandoned-cart-reminder",
    active: true,
    body:
      "Hi {{first_name}}, you left {{product_names}} in your cart.\n\n" +
      "Your cart ({{cart_value}}) is still available here:\n{{recovery_url}}",
  },
  offer: {
    id: "tpl-offer",
    key: "abandoned-cart-offer",
    active: true,
    body:
      "Hi {{first_name}}, your cart ({{cart_value}}) is still waiting.\n\n" +
      "Use {{discount_code}} for {{discount_pct}} off:\n{{recovery_url}}",
  },
};

function makeStep(overrides: Record<string, any> = {}) {
  const oppOverrides = overrides.opp ?? {};
  delete overrides.opp;
  return {
    id: "step-1",
    journeyId: "journey-1",
    stepNumber: 1,
    delayHours: 1,
    channel: "WHATSAPP",
    status: "PENDING",
    offerType: "NO_DISCOUNT",
    offerValue: null,
    journey: {
      id: "journey-1",
      status: "ACTIVE",
      opportunity: {
        id: "opp-1",
        status: "IN_JOURNEY",
        contactId: "contact-1",
        abandonedCheckoutId: "checkout-1",
        cartValue: 350,
        recoveryUrl: "https://shop.example/cart/abc",
        abandonedAt: new Date(Date.now() - 3600_000),
        products: [{ title: "Barrier Repair Serum", shopifyProductId: "p-1" }],
        discountCode: "SAVE10",
        ...oppOverrides,
      },
    },
    ...overrides,
  };
}

function makeDeps(opts: Record<string, any> = {}) {
  const prisma = {
    recoveryJourney: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "journey-1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    recoveryJourneyStep: {
      findMany: jest.fn().mockResolvedValue([opts.step ?? makeStep()]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    revenueOpportunity: { findUnique: jest.fn().mockResolvedValue(null) },
    abandonedCheckout: {
      findUnique: jest.fn().mockResolvedValue({
        status: "ACTIVE",
        recoveredAt: null,
        currencyCode: opts.currencyCode ?? "ILS",
      }),
    },
    customerRevenueAction: { create: jest.fn().mockResolvedValue({}) },
    campaignTouch: { create: jest.fn().mockResolvedValue({}) },
    contact: {
      findUnique: jest.fn().mockResolvedValue({
        phone: "972501234567",
        smsMarketingStatus: "SUBSCRIBED",
        lastOrderAt: null,
        currencyCode: "ILS",
        firstName: "Dana",
        ...(opts.contact ?? {}),
      }),
    },
    contactSuppression: { findFirst: jest.fn().mockResolvedValue(null) },
    commerceSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const messaging = {
    isConfigured: jest.fn().mockReturnValue(true),
    send: jest
      .fn()
      .mockResolvedValue({ success: true, providerMessageId: "wamid-1" }),
  };
  const frequencyCaps = {
    isEligible: jest.fn().mockResolvedValue(opts.withinCaps ?? true),
  };
  const settings = {
    getRevenueSync: () => CODE_REVENUE_DEFAULTS,
    getCommerceSync: jest.fn(),
  };
  const automations = {
    resolveMode: jest.fn().mockResolvedValue({
      mode: opts.mode ?? "LIVE",
      maySend: (opts.mode ?? "LIVE") === "LIVE",
    }),
  };
  const templates = new WhatsAppTemplateService({} as any);
  jest
    .spyOn(templates, "getByKey")
    .mockImplementation(async (key: string) =>
      key === "abandoned-cart-offer"
        ? (TEMPLATES.offer as any)
        : (TEMPLATES.reminder as any),
    );
  const inbox = { recordOutboundAutomation: jest.fn().mockResolvedValue({}) };

  const service = new RecoveryJourneyService(
    prisma as any,
    messaging as any,
    new OfferPolicyEngine(),
    frequencyCaps as any,
    settings as any,
    automations as any,
    templates,
    inbox as any,
  );

  return { service, prisma, messaging, frequencyCaps, automations, templates, inbox };
}

function lastStepUpdate(prisma: any) {
  const calls = prisma.recoveryJourneyStep.update.mock.calls;
  return calls[calls.length - 1][0];
}

describe("RecoveryJourneyService — WhatsApp (M9.6)", () => {
  describe("automation mode gate (Part D)", () => {
    it("does not send when the automation is DISABLED", async () => {
      const { service, messaging, prisma } = makeDeps({ mode: "DISABLED" });

      await service.processAllDueSteps();

      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe(
        "AUTOMATION_DISABLED",
      );
    });

    it("evaluates every gate but sends nothing in DRY_RUN", async () => {
      const { service, messaging, prisma, frequencyCaps } = makeDeps({
        mode: "DRY_RUN",
      });

      await service.processAllDueSteps();

      // The gates still ran...
      expect(frequencyCaps.isEligible).toHaveBeenCalled();
      // ...and the rendered body was recorded for inspection...
      const update = lastStepUpdate(prisma).data;
      expect(update.skipReason).toBe("DRY_RUN");
      expect(update.messageBody).toContain("Dana");
      // ...but nothing left the building.
      expect(messaging.send).not.toHaveBeenCalled();
    });

    it("sends when LIVE", async () => {
      const { service, messaging } = makeDeps({ mode: "LIVE" });
      await service.processAllDueSteps();
      expect(messaging.send).toHaveBeenCalledTimes(1);
    });

    it("checks consent before ever consulting the automation mode", async () => {
      const { service, automations, messaging } = makeDeps({
        contact: { smsMarketingStatus: "NOT_SUBSCRIBED" },
      });

      await service.processAllDueSteps();

      // Consent is the outer gate — an enabled automation cannot bypass it.
      expect(automations.resolveMode).not.toHaveBeenCalled();
      expect(messaging.send).not.toHaveBeenCalled();
    });
  });

  describe("templates (C2)", () => {
    it("uses the reminder template for a non-offer step", async () => {
      const { service, messaging } = makeDeps();
      await service.processAllDueSteps();

      const body = messaging.send.mock.calls[0]![0].body as string;
      expect(body).toContain("Hi Dana");
      expect(body).toContain("Barrier Repair Serum");
      expect(body).toContain("https://shop.example/cart/abc");
      // A reminder must not carry a discount.
      expect(body).not.toContain("SAVE10");
      expect(body).not.toContain("% off");
    });

    it("uses the offer template only for a discount step", async () => {
      const { service, messaging } = makeDeps({
        step: makeStep({ offerType: "PERCENT_DISCOUNT", offerValue: 10 }),
      });

      await service.processAllDueSteps();

      const body = messaging.send.mock.calls[0]![0].body as string;
      expect(body).toContain("SAVE10");
      expect(body).toContain("10%");
    });

    it("falls back to built-in copy when a variable is unavailable", async () => {
      const { service, messaging } = makeDeps({
        contact: { firstName: null },
      });

      await service.processAllDueSteps();

      // Never a half-rendered template.
      const body = messaging.send.mock.calls[0]![0].body as string;
      expect(body).not.toContain("{{");
      expect(body).toContain("https://shop.example/cart/abc");
    });

    it("never emits an unrendered placeholder", async () => {
      const { service, messaging } = makeDeps();
      await service.processAllDueSteps();
      expect(messaging.send.mock.calls[0]![0].body).not.toMatch(/\{\{.*\}\}/);
    });
  });

  describe("currency propagation (C3)", () => {
    it("uses the checkout currency, not a hardcoded symbol", async () => {
      const { service, messaging } = makeDeps({ currencyCode: "ILS" });
      await service.processAllDueSteps();

      const body = messaging.send.mock.calls[0]![0].body as string;
      expect(body).toContain("ILS 350.00");
      expect(body).not.toMatch(/[$₪€£]/);
    });

    it("propagates a different store currency", async () => {
      const { service, messaging } = makeDeps({ currencyCode: "EUR" });
      await service.processAllDueSteps();
      expect(messaging.send.mock.calls[0]![0].body).toContain("EUR 350.00");
    });

    it("prefers the checkout currency over the contact's", async () => {
      const { service, messaging } = makeDeps({
        currencyCode: "USD",
        contact: { currencyCode: "ILS" },
      });
      await service.processAllDueSteps();
      expect(messaging.send.mock.calls[0]![0].body).toContain("USD 350.00");
    });
  });

  describe("safety invariants still hold", () => {
    it("does not send without consent", async () => {
      const { service, messaging, prisma } = makeDeps({
        contact: { smsMarketingStatus: "NOT_SUBSCRIBED" },
      });
      await service.processAllDueSteps();
      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe("NO_CONSENT");
    });

    it("does not send to an unsubscribed contact", async () => {
      const { service, messaging, prisma } = makeDeps({
        contact: { smsMarketingStatus: "UNSUBSCRIBED" },
      });
      await service.processAllDueSteps();
      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe("UNSUBSCRIBED");
    });

    it("fails closed on an unrecognised consent value", async () => {
      const { service, messaging } = makeDeps({
        contact: { smsMarketingStatus: "PENDING" },
      });
      await service.processAllDueSteps();
      expect(messaging.send).not.toHaveBeenCalled();
    });

    it("does not send when frequency capped", async () => {
      const { service, messaging, prisma } = makeDeps({ withinCaps: false });
      await service.processAllDueSteps();
      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe("FREQUENCY_CAP");
    });

    it("does not send when the cart was already purchased", async () => {
      const { service, prisma, messaging } = makeDeps();
      prisma.abandonedCheckout.findUnique.mockResolvedValue({
        status: "RECOVERED",
        recoveredAt: new Date(),
        currencyCode: "ILS",
      });

      await service.processAllDueSteps();

      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe("PURCHASED");
    });

    it("does not send when every cart item is out of stock", async () => {
      const { service, prisma, messaging } = makeDeps();
      prisma.commerceSnapshot.findFirst.mockResolvedValue({
        available: true,
        metricsJson: {
          lowInventoryProducts: [{ productId: "p-1", totalUnits: 0 }],
        },
      });

      await service.processAllDueSteps();

      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe(
        "INVENTORY_UNAVAILABLE",
      );
    });

    it("suppresses the offer but still reminds on partial stock-out", async () => {
      const { service, prisma, messaging } = makeDeps({
        step: makeStep({
          offerType: "PERCENT_DISCOUNT",
          offerValue: 10,
          opp: {
            products: [
              { title: "A", shopifyProductId: "p-1" },
              { title: "B", shopifyProductId: "p-2" },
            ],
          },
        }),
      });
      prisma.commerceSnapshot.findFirst.mockResolvedValue({
        available: true,
        metricsJson: {
          lowInventoryProducts: [{ productId: "p-1", totalUnits: 0 }],
        },
      });

      await service.processAllDueSteps();

      const body = messaging.send.mock.calls[0]![0].body as string;
      expect(body).not.toContain("SAVE10");
    });

    it("does not send to a contact without a phone", async () => {
      const { service, messaging, prisma } = makeDeps({
        contact: { phone: null },
      });
      await service.processAllDueSteps();
      expect(messaging.send).not.toHaveBeenCalled();
      expect(lastStepUpdate(prisma).data.skipReason).toBe("INVALID_PHONE");
    });

    it("lets only one worker claim a due step", async () => {
      const { service, prisma, messaging } = makeDeps();
      // Another worker won the PENDING → EXECUTING transition.
      prisma.recoveryJourneyStep.updateMany.mockResolvedValue({ count: 0 });

      const executed = await service.processAllDueSteps();

      expect(executed).toBe(0);
      expect(messaging.send).not.toHaveBeenCalled();
    });
  });

  describe("observability", () => {
    it("mirrors a successful send into the inbox as AUTOMATION", async () => {
      const { service, inbox } = makeDeps();
      await service.processAllDueSteps();

      expect(inbox.recordOutboundAutomation).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: "AUTOMATION",
          providerMessageId: "wamid-1",
        }),
      );
    });

    it("records a campaign touch so caps count WhatsApp sends", async () => {
      const { service, prisma } = makeDeps();
      await service.processAllDueSteps();

      const touch = prisma.campaignTouch.create.mock.calls[0]![0].data;
      expect(touch.touchType).toBe("SEND");
      expect(touch.metadata.channel).toBe("WHATSAPP");
    });

    it("does not mirror or record a touch for a skipped step", async () => {
      const { service, prisma, inbox } = makeDeps({ mode: "DISABLED" });
      await service.processAllDueSteps();

      expect(inbox.recordOutboundAutomation).not.toHaveBeenCalled();
      expect(prisma.campaignTouch.create).not.toHaveBeenCalled();
    });
  });
});
