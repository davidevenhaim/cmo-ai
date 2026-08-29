import {
  BroadcastError,
  WhatsAppBroadcastService,
} from "./whatsapp-broadcast.service";
import { WhatsAppTemplateService } from "./whatsapp-template.service";

const BODY = "Hi {{first_name}}, we have news.";

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    phone: "972501234567",
    smsMarketingStatus: "SUBSCRIBED",
    firstName: "Dana",
    currencyCode: "ILS",
    ...overrides,
  };
}

function makePrisma(contacts = [contact()]) {
  // `any` keeps jest from narrowing the mock's return type to this exact
  // literal — individual tests override status/confirmedAt freely.
  const broadcast: any = {
    id: "b-1",
    brandId: "luminesce-brand-001",
    name: "Spring drop",
    segmentId: null,
    templateId: null,
    renderedBody: BODY,
    status: "DRAFT",
    confirmedAt: null,
  };
  return {
    _broadcast: broadcast,
    whatsAppBroadcast: {
      findFirst: jest.fn(async (): Promise<any> => ({
        ...broadcast,
        template: null,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: "b-1", ...data })),
      update: jest.fn(async ({ data }: any): Promise<any> => ({
        ...broadcast,
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    whatsAppBroadcastRecipient: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    contact: {
      findMany: jest.fn(async () => contacts),
      findUnique: jest.fn(async ({ where }: any) =>
        contacts.find((c) => c.id === where.id) ?? null,
      ),
    },
    contactSuppression: { findFirst: jest.fn().mockResolvedValue(null) },
    segment: { findFirst: jest.fn().mockResolvedValue({ id: "s-1", type: "VIP" }) },
    campaignTouch: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeDeps(contacts = [contact()]) {
  const prisma = makePrisma(contacts);
  const waha = {
    sendText: jest
      .fn()
      .mockResolvedValue({ ok: true, data: { providerMessageId: "wamid-1" } }),
  };
  const session = { canSend: jest.fn().mockResolvedValue(true) };
  const templates = new WhatsAppTemplateService({} as any);
  const frequencyCaps = { isEligible: jest.fn().mockResolvedValue(true) };
  const inbox = { recordOutboundAutomation: jest.fn().mockResolvedValue({}) };
  const service = new WhatsAppBroadcastService(
    prisma as any,
    waha as any,
    session as any,
    templates,
    frequencyCaps as any,
    inbox as any,
  );
  return { service, prisma, waha, session, frequencyCaps, inbox };
}

describe("WhatsAppBroadcastService", () => {
  describe("dry run — audience calculation", () => {
    it("counts an eligible subscriber as an expected send", async () => {
      const { service } = makeDeps();
      const { audience } = await service.dryRun("b-1");

      expect(audience.total).toBe(1);
      expect(audience.eligible).toBe(1);
      expect(audience.expectedSends).toBe(1);
    });

    it("buckets a contact with no consent", async () => {
      const { service } = makeDeps([
        contact({ smsMarketingStatus: "NOT_SUBSCRIBED" }),
      ]);
      const { audience } = await service.dryRun("b-1");

      expect(audience.noConsent).toBe(1);
      expect(audience.eligible).toBe(0);
      expect(audience.expectedSends).toBe(0);
    });

    it("buckets an unsubscribed contact as no consent", async () => {
      const { service } = makeDeps([
        contact({ smsMarketingStatus: "UNSUBSCRIBED" }),
      ]);
      const { audience } = await service.dryRun("b-1");
      expect(audience.noConsent).toBe(1);
    });

    it("buckets an invalid phone", async () => {
      const { service } = makeDeps([contact({ phone: "123" })]);
      const { audience } = await service.dryRun("b-1");
      expect(audience.invalidPhone).toBe(1);
    });

    it("buckets a suppressed contact", async () => {
      const { service, prisma } = makeDeps();
      prisma.contactSuppression.findFirst.mockResolvedValue({
        reason: "PURCHASE_COMPLETED",
      });
      const { audience } = await service.dryRun("b-1");
      expect(audience.suppressed).toBe(1);
    });

    it("buckets a frequency-capped contact", async () => {
      const { service, frequencyCaps } = makeDeps();
      frequencyCaps.isEligible.mockResolvedValue(false);
      const { audience } = await service.dryRun("b-1");
      expect(audience.frequencyCapped).toBe(1);
    });

    it("puts every contact in exactly one bucket", async () => {
      const { service } = makeDeps([
        contact({ id: "c-1" }),
        contact({ id: "c-2", smsMarketingStatus: "NOT_SUBSCRIBED" }),
        contact({ id: "c-3", phone: "1" }),
      ]);
      const { audience } = await service.dryRun("b-1");

      const bucketed =
        audience.eligible +
        audience.noConsent +
        audience.frequencyCapped +
        audience.invalidPhone +
        audience.suppressed;
      expect(bucketed).toBe(audience.total);
    });

    it("suppresses a contact whose template cannot be fully rendered", async () => {
      const { service, prisma } = makeDeps([contact({ firstName: null })]);
      prisma.whatsAppBroadcast.findFirst.mockResolvedValue({
        ...prisma._broadcast,
        template: null,
        renderedBody: "Hi {{first_name}}!",
      });

      const { audience } = await service.dryRun("b-1");
      expect(audience.suppressed).toBe(1);
      expect(audience.eligible).toBe(0);
    });

    it("freezes the body so a later template edit cannot change the send", async () => {
      const { service, prisma } = makeDeps();
      prisma.whatsAppBroadcast.findFirst.mockResolvedValue({
        ...prisma._broadcast,
        template: { body: "Frozen copy for {{first_name}}" },
      });

      await service.dryRun("b-1");

      const update = prisma.whatsAppBroadcast.update.mock.calls[0]![0];
      expect(update.data.renderedBody).toBe("Frozen copy for {{first_name}}");
      expect(update.data.status).toBe("AWAITING_CONFIRMATION");
    });

    it("rebuilds the recipient worklist on each dry run", async () => {
      const { service, prisma } = makeDeps();
      await service.dryRun("b-1");
      expect(prisma.whatsAppBroadcastRecipient.deleteMany).toHaveBeenCalledWith(
        { where: { broadcastId: "b-1" } },
      );
    });

    it("refuses to dry-run a broadcast that already sent", async () => {
      const { service, prisma } = makeDeps();
      prisma.whatsAppBroadcast.findFirst.mockResolvedValue({
        ...prisma._broadcast,
        status: "SENT",
        template: null,
      });
      await expect(service.dryRun("b-1")).rejects.toThrow(BroadcastError);
    });
  });

  describe("confirmation", () => {
    it("requires a dry run before confirmation", async () => {
      const { service } = makeDeps();
      await expect(service.confirm("b-1", "admin")).rejects.toMatchObject({
        code: "DRY_RUN_REQUIRED",
      });
    });

    it("records who confirmed and when", async () => {
      const { service, prisma } = makeDeps();
      prisma.whatsAppBroadcast.findFirst.mockResolvedValue({
        ...prisma._broadcast,
        status: "AWAITING_CONFIRMATION",
      });

      await service.confirm("b-1", "owner@example.com");

      const update = prisma.whatsAppBroadcast.update.mock.calls[0]![0];
      expect(update.data.confirmedBy).toBe("owner@example.com");
      expect(update.data.confirmedAt).toBeInstanceOf(Date);
    });

    it("refuses to send without confirmation", async () => {
      const { service, waha } = makeDeps();
      await expect(service.send("b-1")).rejects.toMatchObject({
        code: "CONFIRMATION_REQUIRED",
      });
      expect(waha.sendText).not.toHaveBeenCalled();
    });
  });

  describe("send", () => {
    function confirmedPrisma(prisma: ReturnType<typeof makePrisma>) {
      prisma.whatsAppBroadcast.findFirst.mockResolvedValue({
        ...prisma._broadcast,
        status: "AWAITING_CONFIRMATION",
        confirmedAt: new Date(),
      });
      prisma.whatsAppBroadcastRecipient.findMany.mockResolvedValue([
        { id: "r-1", contactId: "c-1", status: "PENDING" },
      ]);
    }

    it("sends to a confirmed, still-eligible recipient", async () => {
      const { service, prisma, waha } = makeDeps();
      confirmedPrisma(prisma);

      const result = await service.send("b-1");

      expect(result.sent).toBe(1);
      expect(waha.sendText).toHaveBeenCalledWith(
        "972501234567@c.us",
        "Hi Dana, we have news.",
      );
    });

    it("refuses to send while disconnected", async () => {
      const { service, prisma, session, waha } = makeDeps();
      confirmedPrisma(prisma);
      session.canSend.mockResolvedValue(false);

      await expect(service.send("b-1")).rejects.toMatchObject({
        code: "NOT_CONNECTED",
      });
      expect(waha.sendText).not.toHaveBeenCalled();
    });

    it("suppresses a recipient whose consent changed after approval", async () => {
      const contacts = [contact()];
      const { service, prisma, waha } = makeDeps(contacts);
      confirmedPrisma(prisma);
      // Consent revoked between the approved dry run and the send.
      contacts[0]!.smsMarketingStatus = "UNSUBSCRIBED";

      const result = await service.send("b-1");

      expect(result.sent).toBe(0);
      expect(result.suppressed).toBe(1);
      expect(waha.sendText).not.toHaveBeenCalled();
    });

    it("re-checks frequency caps immediately before sending", async () => {
      const { service, prisma, frequencyCaps, waha } = makeDeps();
      confirmedPrisma(prisma);
      frequencyCaps.isEligible.mockResolvedValue(false);

      const result = await service.send("b-1");

      expect(result.suppressed).toBe(1);
      expect(waha.sendText).not.toHaveBeenCalled();
    });

    it("refuses a second concurrent execution", async () => {
      const { service, prisma } = makeDeps();
      confirmedPrisma(prisma);
      // The atomic claim finds no AWAITING_CONFIRMATION row to transition.
      prisma.whatsAppBroadcast.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.send("b-1")).rejects.toMatchObject({
        code: "ALREADY_RUNNING",
      });
    });

    it("claims each recipient before the network call", async () => {
      const { service, prisma } = makeDeps();
      confirmedPrisma(prisma);

      await service.send("b-1");

      const claim =
        prisma.whatsAppBroadcastRecipient.updateMany.mock.calls[0]![0];
      expect(claim.where).toEqual({ id: "r-1", status: "PENDING" });
      expect(claim.data.status).toBe("SENDING");
    });

    it("skips a recipient another worker already claimed", async () => {
      const { service, prisma, waha } = makeDeps();
      confirmedPrisma(prisma);
      prisma.whatsAppBroadcastRecipient.updateMany.mockResolvedValue({
        count: 0,
      });

      const result = await service.send("b-1");

      expect(waha.sendText).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });

    it("counts an ambiguous send outcome against the frequency cap", async () => {
      const { service, prisma, waha } = makeDeps();
      confirmedPrisma(prisma);
      waha.sendText.mockResolvedValue({
        ok: false,
        outcome: "UNKNOWN",
        error: "timeout",
      });

      const result = await service.send("b-1");

      expect(result.failed).toBe(1);
      // The message may have landed, so it must consume cap budget.
      expect(prisma.campaignTouch.create).toHaveBeenCalled();
    });

    it("records a touch for each successful send", async () => {
      const { service, prisma } = makeDeps();
      confirmedPrisma(prisma);

      await service.send("b-1");

      const touch = prisma.campaignTouch.create.mock.calls[0]![0].data;
      expect(touch.touchType).toBe("SEND");
      expect(touch.metadata.source).toBe("WHATSAPP_BROADCAST");
    });

    it("mirrors the send into the inbox tagged BROADCAST", async () => {
      const { service, prisma, inbox } = makeDeps();
      confirmedPrisma(prisma);

      await service.send("b-1");

      expect(inbox.recordOutboundAutomation).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "BROADCAST" }),
      );
    });
  });

  describe("cancel", () => {
    it("cancels a draft", async () => {
      const { service, prisma } = makeDeps();
      await service.cancel("b-1");
      const update = prisma.whatsAppBroadcast.update.mock.calls[0]![0];
      expect(update.data.status).toBe("CANCELLED");
    });

    it("refuses to cancel an in-flight send", async () => {
      const { service, prisma } = makeDeps();
      prisma.whatsAppBroadcast.findFirst.mockResolvedValue({
        ...prisma._broadcast,
        status: "SENDING",
      });
      await expect(service.cancel("b-1")).rejects.toThrow(BroadcastError);
    });
  });
});
