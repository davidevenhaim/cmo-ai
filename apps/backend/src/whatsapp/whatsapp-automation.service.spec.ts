import {
  AutomationError,
  WhatsAppAutomationService,
} from "./whatsapp-automation.service";

function makePrisma(existing: Record<string, any> | null = null) {
  return {
    whatsAppAutomation: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "a-1" }),
      update: jest.fn().mockResolvedValue({ id: "a-1" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    whatsAppTemplate: {
      findUnique: jest.fn().mockResolvedValue({ id: "tpl-1" }),
    },
  };
}

describe("WhatsAppAutomationService", () => {
  describe("defaults", () => {
    it("never seeds an automation as LIVE", async () => {
      const prisma = makePrisma(null);
      const service = new WhatsAppAutomationService(prisma as any);

      await service.ensureDefaults();

      expect(prisma.whatsAppAutomation.create).toHaveBeenCalled();
      for (const call of prisma.whatsAppAutomation.create.mock.calls) {
        expect(call[0].data.mode).toBe("DISABLED");
      }
    });

    it("seeds one row per supported flow", async () => {
      const prisma = makePrisma(null);
      const service = new WhatsAppAutomationService(prisma as any);
      await service.ensureDefaults();

      const types = prisma.whatsAppAutomation.create.mock.calls.map(
        (c) => c[0].data.type,
      );
      expect(types).toEqual(
        expect.arrayContaining([
          "ABANDONED_CART",
          "REPLENISHMENT",
          "WIN_BACK",
          "VIP",
          "BACK_IN_STOCK",
          "POST_PURCHASE",
          "REVIEW_REQUEST",
        ]),
      );
    });

    it("does not overwrite an existing configuration", async () => {
      const prisma = makePrisma({ id: "a-1", type: "VIP", mode: "LIVE" });
      const service = new WhatsAppAutomationService(prisma as any);
      await service.ensureDefaults();
      expect(prisma.whatsAppAutomation.create).not.toHaveBeenCalled();
    });
  });

  describe("resolveMode", () => {
    it("fails closed when no configuration exists", async () => {
      const prisma = makePrisma(null);
      const service = new WhatsAppAutomationService(prisma as any);

      const result = await service.resolveMode("ABANDONED_CART");

      expect(result.mode).toBe("DISABLED");
      expect(result.maySend).toBe(false);
    });

    it("does not permit sending while DISABLED", async () => {
      const service = new WhatsAppAutomationService(
        makePrisma({ mode: "DISABLED" }) as any,
      );
      expect((await service.resolveMode("ABANDONED_CART")).maySend).toBe(false);
    });

    it("does not permit sending in DRY_RUN", async () => {
      const service = new WhatsAppAutomationService(
        makePrisma({ mode: "DRY_RUN" }) as any,
      );
      const result = await service.resolveMode("ABANDONED_CART");
      expect(result.mode).toBe("DRY_RUN");
      expect(result.maySend).toBe(false);
    });

    it("permits sending only when LIVE", async () => {
      const service = new WhatsAppAutomationService(
        makePrisma({ mode: "LIVE" }) as any,
      );
      expect((await service.resolveMode("ABANDONED_CART")).maySend).toBe(true);
    });
  });

  describe("patch", () => {
    it("refuses to go LIVE without a template", async () => {
      const prisma = makePrisma({ mode: "DISABLED", templateId: null });
      const service = new WhatsAppAutomationService(prisma as any);

      await expect(
        service.patch("ABANDONED_CART", { mode: "LIVE" }),
      ).rejects.toThrow(AutomationError);
    });

    it("allows LIVE when a template is already attached", async () => {
      const prisma = makePrisma({ mode: "DISABLED", templateId: "tpl-1" });
      const service = new WhatsAppAutomationService(prisma as any);

      await service.patch("ABANDONED_CART", { mode: "LIVE" });

      expect(prisma.whatsAppAutomation.update).toHaveBeenCalled();
    });

    it("allows LIVE when a template is supplied in the same patch", async () => {
      const prisma = makePrisma({ mode: "DISABLED", templateId: null });
      const service = new WhatsAppAutomationService(prisma as any);

      await service.patch("ABANDONED_CART", {
        mode: "LIVE",
        templateId: "tpl-9",
      });

      expect(prisma.whatsAppAutomation.update).toHaveBeenCalled();
    });

    it("rejects an invalid mode", async () => {
      const service = new WhatsAppAutomationService(
        makePrisma({ mode: "DISABLED" }) as any,
      );
      await expect(
        service.patch("ABANDONED_CART", { mode: "TURBO" }),
      ).rejects.toThrow(AutomationError);
    });

    it("always allows disabling", async () => {
      const prisma = makePrisma({ mode: "LIVE", templateId: null });
      const service = new WhatsAppAutomationService(prisma as any);
      await service.patch("ABANDONED_CART", { mode: "DISABLED" });
      expect(prisma.whatsAppAutomation.update).toHaveBeenCalled();
    });
  });
});
