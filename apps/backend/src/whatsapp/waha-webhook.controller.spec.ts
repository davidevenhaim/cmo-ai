import { UnauthorizedException } from "@nestjs/common";
import { WahaWebhookController } from "./waha-webhook.controller";

function makePrisma(duplicateEvent = false) {
  return {
    processedWahaEvent: {
      create: duplicateEvent
        ? jest.fn().mockRejectedValue(new Error("Unique constraint failed"))
        : jest.fn().mockResolvedValue({ id: "evt-1" }),
    },
    whatsAppConversation: {
      upsert: jest.fn().mockResolvedValue({ id: "conv-1" }),
    },
    whatsAppMessage: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    whatsAppSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function makeConfig(secret = "") {
  return { get: jest.fn(() => secret) };
}

function messageEvent(overrides: Record<string, any> = {}) {
  return {
    id: "evt-1",
    event: "message",
    payload: {
      id: { _serialized: "wamid-inbound-1" },
      from: "972501234567@c.us",
      fromMe: false,
      body: "Where is my order?",
      timestamp: 1700000000,
      notifyName: "Dana",
      ...overrides,
    },
  };
}

describe("WahaWebhookController", () => {
  describe("authentication", () => {
    it("rejects a bad secret when one is configured", async () => {
      const controller = new WahaWebhookController(
        makePrisma() as any,
        makeConfig("expected-secret") as any,
      );

      await expect(
        controller.receive(messageEvent(), "wrong-secret"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("accepts the configured secret", async () => {
      const controller = new WahaWebhookController(
        makePrisma() as any,
        makeConfig("expected-secret") as any,
      );
      const result = await controller.receive(
        messageEvent(),
        "expected-secret",
      );
      expect(result.status).toBe("ok");
    });

    it("does not require a secret when none is configured", async () => {
      const controller = new WahaWebhookController(
        makePrisma() as any,
        makeConfig("") as any,
      );
      const result = await controller.receive(messageEvent(), undefined);
      expect(result.status).toBe("ok");
    });
  });

  describe("duplicate delivery (invariant 12)", () => {
    it("processes an event once", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      const result = await controller.receive(messageEvent());

      expect(result.status).toBe("ok");
      expect(prisma.whatsAppMessage.createMany).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when WAHA retries the same event", async () => {
      const prisma = makePrisma(true);
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      const result = await controller.receive(messageEvent());

      expect(result.status).toBe("duplicate");
      expect(prisma.whatsAppMessage.createMany).not.toHaveBeenCalled();
      expect(prisma.whatsAppConversation.upsert).not.toHaveBeenCalled();
    });

    it("ignores an event with no id rather than processing it blind", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      const result = await controller.receive({ event: "message", payload: {} });

      expect(result.status).toBe("ignored");
      expect(prisma.processedWahaEvent.create).not.toHaveBeenCalled();
    });

    it("also guards message creation on the provider id", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive(messageEvent());

      const call = prisma.whatsAppMessage.createMany.mock.calls[0]![0];
      expect(call.skipDuplicates).toBe(true);
    });
  });

  describe("message origin (invariant 13)", () => {
    it("stores a customer message as INBOUND", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive(messageEvent());

      const data = prisma.whatsAppMessage.createMany.mock.calls[0]![0].data[0];
      expect(data.direction).toBe("INBOUND");
      expect(data.origin).toBe("INBOUND");
      expect(data.body).toBe("Where is my order?");
    });

    it("stores a message sent from the owner's phone as OWNER_MANUAL", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive(messageEvent({ fromMe: true }));

      const data = prisma.whatsAppMessage.createMany.mock.calls[0]![0].data[0];
      expect(data.direction).toBe("OUTBOUND");
      expect(data.origin).toBe("OWNER_MANUAL");
    });

    it("increments unread only for inbound messages", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive(messageEvent({ fromMe: true }));

      const upsert = prisma.whatsAppConversation.upsert.mock.calls[0]![0];
      expect(upsert.update.unreadCount).toBeUndefined();
    });
  });

  describe("ack and session events", () => {
    it("updates delivery state from an ack", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive({
        id: "evt-ack",
        event: "message.ack",
        payload: { id: { _serialized: "wamid-1" }, ack: 3 },
      });

      expect(prisma.whatsAppMessage.updateMany).toHaveBeenCalledWith({
        where: { providerMessageId: "wamid-1" },
        data: { deliveryState: "READ" },
      });
    });

    it("ignores an unmappable ack code", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive({
        id: "evt-ack-2",
        event: "message.ack",
        payload: { id: "wamid-1", ack: 99 },
      });

      expect(prisma.whatsAppMessage.updateMany).not.toHaveBeenCalled();
    });

    it("mirrors a session status change", async () => {
      const prisma = makePrisma();
      const controller = new WahaWebhookController(
        prisma as any,
        makeConfig() as any,
      );

      await controller.receive({
        id: "evt-sess",
        event: "session.status",
        payload: { status: "SCAN_QR_CODE" },
      });

      expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SCAN_QR" }),
        }),
      );
    });
  });
});
