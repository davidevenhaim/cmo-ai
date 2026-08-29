import {
  WhatsAppInboxService,
  WhatsAppSendError,
} from "./whatsapp-inbox.service";

function makePrisma() {
  return {
    whatsAppConversation: {
      findFirst: jest.fn().mockResolvedValue({
        id: "conv-1",
        brandId: "luminesce-brand-001",
        chatId: "972501234567@c.us",
        phone: "972501234567",
      }),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: "conv-1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    whatsAppMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "msg-1" }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contact: { findFirst: jest.fn().mockResolvedValue({ id: "contact-1" }) },
  };
}

function makeWaha(overrides: Record<string, any> = {}) {
  return {
    listChats: jest.fn().mockResolvedValue({ ok: true, data: [] }),
    listMessages: jest.fn().mockResolvedValue({ ok: true, data: [] }),
    sendText: jest
      .fn()
      .mockResolvedValue({ ok: true, data: { providerMessageId: "wamid-1" } }),
    ...overrides,
  };
}

function makeSession(canSend = true) {
  return { canSend: jest.fn().mockResolvedValue(canSend) };
}

describe("WhatsAppInboxService", () => {
  describe("conversation sync", () => {
    it("does nothing while disconnected", async () => {
      const waha = makeWaha();
      const service = new WhatsAppInboxService(
        makePrisma() as any,
        waha as any,
        makeSession(false) as any,
      );

      const synced = await service.syncConversations();

      expect(synced).toBe(0);
      expect(waha.listChats).not.toHaveBeenCalled();
    });

    it("upserts chats and links them to a matching contact", async () => {
      const prisma = makePrisma();
      const waha = makeWaha({
        listChats: jest.fn().mockResolvedValue({
          ok: true,
          data: [
            {
              id: "972501234567@c.us",
              name: "Dana",
              timestamp: 1700000000,
              unreadCount: 1,
              lastMessage: "hello",
            },
          ],
        }),
      });
      const service = new WhatsAppInboxService(
        prisma as any,
        waha as any,
        makeSession() as any,
      );

      const synced = await service.syncConversations();

      expect(synced).toBe(1);
      const upsert = prisma.whatsAppConversation.upsert.mock.calls[0]![0];
      expect(upsert.create.phone).toBe("972501234567");
      expect(upsert.create.contactId).toBe("contact-1");
    });

    it("returns 0 when the chat list call fails", async () => {
      const service = new WhatsAppInboxService(
        makePrisma() as any,
        makeWaha({
          listChats: jest.fn().mockResolvedValue({ ok: false, error: "down" }),
        }) as any,
        makeSession() as any,
      );
      expect(await service.syncConversations()).toBe(0);
    });
  });

  describe("conversation loading", () => {
    it("serves persisted messages when disconnected", async () => {
      const prisma = makePrisma();
      const waha = makeWaha();
      const service = new WhatsAppInboxService(
        prisma as any,
        waha as any,
        makeSession(false) as any,
      );

      const result = await service.getConversation("conv-1");

      expect(result).not.toBeNull();
      expect(waha.listMessages).not.toHaveBeenCalled();
      expect(prisma.whatsAppMessage.findMany).toHaveBeenCalled();
    });

    it("returns null for an unknown conversation", async () => {
      const prisma = makePrisma();
      prisma.whatsAppConversation.findFirst.mockResolvedValue(null);
      const service = new WhatsAppInboxService(
        prisma as any,
        makeWaha() as any,
        makeSession() as any,
      );
      expect(await service.getConversation("nope")).toBeNull();
    });

    it("labels a message sent from the owner's own phone as OWNER_MANUAL", async () => {
      const prisma = makePrisma();
      const waha = makeWaha({
        listMessages: jest.fn().mockResolvedValue({
          ok: true,
          data: [
            { id: "m-1", fromMe: true, body: "on its way", timestamp: 1700000000, ack: 2 },
            { id: "m-2", fromMe: false, body: "thanks!", timestamp: 1700000100, ack: null },
          ],
        }),
      });
      const service = new WhatsAppInboxService(
        prisma as any,
        waha as any,
        makeSession() as any,
      );

      await service.getConversation("conv-1");

      const created = prisma.whatsAppMessage.createMany.mock.calls[0]![0].data;
      expect(created[0].origin).toBe("OWNER_MANUAL");
      expect(created[0].direction).toBe("OUTBOUND");
      expect(created[1].origin).toBe("INBOUND");
    });

    it("does not re-create a message it already stored", async () => {
      const prisma = makePrisma();
      prisma.whatsAppMessage.findMany.mockResolvedValue([
        { providerMessageId: "m-1" },
      ]);
      const waha = makeWaha({
        listMessages: jest.fn().mockResolvedValue({
          ok: true,
          data: [
            { id: "m-1", fromMe: true, body: "x", timestamp: 1700000000, ack: 3 },
          ],
        }),
      });
      const service = new WhatsAppInboxService(
        prisma as any,
        waha as any,
        makeSession() as any,
      );

      await service.getConversation("conv-1");

      expect(prisma.whatsAppMessage.createMany).not.toHaveBeenCalled();
      // But the delivery state is refreshed.
      expect(prisma.whatsAppMessage.updateMany).toHaveBeenCalledWith({
        where: { providerMessageId: "m-1" },
        data: { deliveryState: "READ" },
      });
    });
  });

  describe("manual reply", () => {
    it("records the owner's reply with OWNER_MANUAL origin", async () => {
      const prisma = makePrisma();
      const service = new WhatsAppInboxService(
        prisma as any,
        makeWaha() as any,
        makeSession() as any,
      );

      await service.sendManualReply("conv-1", "Shipping today!");

      const data = prisma.whatsAppMessage.create.mock.calls[0]![0].data;
      expect(data.origin).toBe("OWNER_MANUAL");
      expect(data.direction).toBe("OUTBOUND");
      expect(data.body).toBe("Shipping today!");
    });

    it("refuses to send while disconnected", async () => {
      const service = new WhatsAppInboxService(
        makePrisma() as any,
        makeWaha() as any,
        makeSession(false) as any,
      );

      await expect(service.sendManualReply("conv-1", "hi")).rejects.toThrow(
        WhatsAppSendError,
      );
      await expect(
        service.sendManualReply("conv-1", "hi"),
      ).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    });

    it("throws for an unknown conversation", async () => {
      const prisma = makePrisma();
      prisma.whatsAppConversation.findFirst.mockResolvedValue(null);
      const service = new WhatsAppInboxService(
        prisma as any,
        makeWaha() as any,
        makeSession() as any,
      );
      await expect(service.sendManualReply("nope", "hi")).rejects.toThrow(
        WhatsAppSendError,
      );
    });

    it("records an ambiguous timeout without retrying", async () => {
      const prisma = makePrisma();
      const waha = makeWaha({
        sendText: jest
          .fn()
          .mockResolvedValue({ ok: false, outcome: "UNKNOWN", error: "timeout" }),
      });
      const service = new WhatsAppInboxService(
        prisma as any,
        waha as any,
        makeSession() as any,
      );

      await expect(
        service.sendManualReply("conv-1", "hi"),
      ).rejects.toMatchObject({ code: "SEND_UNKNOWN" });

      // Exactly one attempt, and the ambiguous outcome is persisted.
      expect(waha.sendText).toHaveBeenCalledTimes(1);
      const data = prisma.whatsAppMessage.create.mock.calls[0]![0].data;
      expect(data.deliveryState).toBe("UNKNOWN");
    });

    it("surfaces a terminal send failure without storing a sent message", async () => {
      const prisma = makePrisma();
      const service = new WhatsAppInboxService(
        prisma as any,
        makeWaha({
          sendText: jest.fn().mockResolvedValue({
            ok: false,
            outcome: "TERMINAL",
            error: "invalid chatId",
          }),
        }) as any,
        makeSession() as any,
      );

      await expect(
        service.sendManualReply("conv-1", "hi"),
      ).rejects.toMatchObject({ code: "SEND_FAILED" });
      expect(prisma.whatsAppMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("automated sends", () => {
    it("tags an automated send AUTOMATION, not OWNER_MANUAL", async () => {
      const prisma = makePrisma();
      const service = new WhatsAppInboxService(
        prisma as any,
        makeWaha() as any,
        makeSession() as any,
      );

      await service.recordOutboundAutomation({
        phone: "972501234567",
        chatId: "972501234567@c.us",
        body: "Your cart is waiting",
        providerMessageId: "wamid-auto-1",
        origin: "AUTOMATION",
        metadata: { journeyId: "j-1" },
      });

      const data = prisma.whatsAppMessage.createMany.mock.calls[0]![0].data[0];
      expect(data.origin).toBe("AUTOMATION");
      expect(data.direction).toBe("OUTBOUND");
    });

    it("is idempotent on the provider message id", async () => {
      const prisma = makePrisma();
      const service = new WhatsAppInboxService(
        prisma as any,
        makeWaha() as any,
        makeSession() as any,
      );

      await service.recordOutboundAutomation({
        phone: "972501234567",
        chatId: "972501234567@c.us",
        body: "x",
        providerMessageId: "wamid-auto-1",
        origin: "BROADCAST",
      });

      const call = prisma.whatsAppMessage.createMany.mock.calls[0]![0];
      expect(call.skipDuplicates).toBe(true);
    });
  });
});
