/**
 * campaign-execution.service.spec.ts
 * M6.9 Email Execution Foundation — dry run, consent re-check, frequency cap,
 * bounce suppression, duplicate execution guard, unsubscribe-after-approval.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { CampaignExecutionService } from "./campaign-execution.service";
import { PrismaService } from "../prisma.service";
import { ContactService } from "./contact.service";
import { SegmentService } from "./segment.service";
import { FrequencyCapService } from "./frequency-cap.service";
import { MockEmailProvider } from "./email/mock-email.provider";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  campaign: { findUnique: jest.fn(), update: jest.fn() },
  campaignExecution: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  campaignTouch: { create: jest.fn() },
  segment: { findUnique: jest.fn() },
};

const mockContactService = {
  list: jest.fn(),
  isMarketingEligible: jest.fn(),
};
const mockSegmentService = { getMembersForSegment: jest.fn() };
const mockFrequencyCapService = { isEligible: jest.fn() };
const mockEmailProvider = {
  name: "mock",
  status: jest.fn(),
  send: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const approvedCampaign = {
  id: "camp-001",
  brandId: "luminesce-brand-001",
  status: "APPROVED",
  type: "NEWSLETTER",
  segmentId: null,
  subject: "Monthly Update",
  previewText: "See what's new",
};

const contactA = { id: "c-001", email: "a@example.com" };
const contactB = { id: "c-002", email: "b@example.com" };
const contactC = { id: "c-003", email: null }; // no email

const pendingExecution = {
  id: "exec-001",
  campaignId: "camp-001",
  mode: "DRY_RUN",
  status: "PENDING",
  campaign: approvedCampaign,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
describe("CampaignExecutionService", () => {
  let service: CampaignExecutionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignExecutionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContactService, useValue: mockContactService },
        { provide: SegmentService, useValue: mockSegmentService },
        { provide: FrequencyCapService, useValue: mockFrequencyCapService },
        { provide: MockEmailProvider, useValue: mockEmailProvider },
      ],
    }).compile();

    service = module.get(CampaignExecutionService);
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe("create", () => {
    it("creates DRY_RUN execution by default for APPROVED campaign", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(approvedCampaign);
      mockPrisma.campaignExecution.create.mockResolvedValue(pendingExecution);

      const exec = await service.create("camp-001");

      expect(mockPrisma.campaignExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mode: "DRY_RUN", status: "PENDING" }),
        }),
      );
      expect(exec.mode).toBe("DRY_RUN");
    });

    it("creates LIVE execution when explicitly requested", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(approvedCampaign);
      mockPrisma.campaignExecution.create.mockResolvedValue({
        ...pendingExecution,
        mode: "LIVE",
      });

      const exec = await service.create("camp-001", "LIVE");
      expect(exec.mode).toBe("LIVE");
    });

    it("rejects if campaign not APPROVED", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        ...approvedCampaign,
        status: "DRAFT",
      });
      await expect(service.create("camp-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects if campaign not found", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(null);
      await expect(service.create("bad")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // execute — DRY_RUN
  // -------------------------------------------------------------------------
  describe("execute (DRY_RUN)", () => {
    it("reports eligible/suppressed without sending", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactB]);
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);

      const result = await service.execute("exec-001");

      expect(result.mode).toBe("DRY_RUN");
      expect(result.sent).toBe(2); // counted but not sent
      expect(result.suppressed).toBe(0);
      expect(mockEmailProvider.send).not.toHaveBeenCalled();
    });

    it("suppresses contacts with no consent — unsubscribed after campaign approval", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      // contactA subscribed, contactB unsubscribed AFTER campaign was approved
      mockContactService.list.mockResolvedValue([contactA, contactB]);
      mockContactService.isMarketingEligible
        .mockResolvedValueOnce(true) // contactA
        .mockResolvedValueOnce(false); // contactB unsubscribed
      mockFrequencyCapService.isEligible.mockResolvedValue(true);

      const result = await service.execute("exec-001");

      expect(result.sent).toBe(1);
      expect(result.suppressed).toBe(1);
      expect(result.snapshot.suppressionBreakdown.NO_CONSENT).toBe(1);
      expect(mockEmailProvider.send).not.toHaveBeenCalled();
    });

    it("suppresses contacts hitting frequency cap", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactB]);
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible
        .mockResolvedValueOnce(true) // contactA passes
        .mockResolvedValueOnce(false); // contactB capped

      const result = await service.execute("exec-001");

      expect(result.sent).toBe(1);
      expect(result.suppressed).toBe(1);
      expect(result.snapshot.suppressionBreakdown.FREQUENCY_CAP).toBe(1);
    });

    it("suppresses contacts with no email address", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactC]); // contactC has no email
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);

      const result = await service.execute("exec-001");

      expect(result.suppressed).toBe(1);
      expect(result.snapshot.suppressionBreakdown.NO_EMAIL).toBe(1);
      expect(mockContactService.isMarketingEligible).not.toHaveBeenCalledWith(
        contactC.id,
      );
    });

    it("reports full snapshot: total, eligible, suppressed", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactB, contactC]);
      mockContactService.isMarketingEligible
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);

      const result = await service.execute("exec-001");

      expect(result.snapshot.total).toBe(3);
      expect(result.snapshot.eligible).toBe(1);
      expect(result.snapshot.suppressed).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // execute — LIVE mode
  // -------------------------------------------------------------------------
  describe("execute (LIVE)", () => {
    const liveExecution = { ...pendingExecution, mode: "LIVE" };

    it("sends emails to eligible contacts via provider", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(liveExecution);
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactB]);
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProvider.send.mockResolvedValue({
        messageId: "msg-001",
        status: "SENT",
      });
      mockPrisma.campaignTouch.create.mockResolvedValue({});

      const result = await service.execute("exec-001");

      expect(result.sent).toBe(2);
      expect(mockEmailProvider.send).toHaveBeenCalledTimes(2);
    });

    it("does not send to unsubscribed contact (consent re-check at execution time)", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(liveExecution);
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactB]);
      mockContactService.isMarketingEligible
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false); // unsubscribed after campaign creation
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProvider.send.mockResolvedValue({
        messageId: "m",
        status: "SENT",
      });
      mockPrisma.campaignTouch.create.mockResolvedValue({});

      const result = await service.execute("exec-001");

      expect(mockEmailProvider.send).toHaveBeenCalledTimes(1);
      expect(result.suppressed).toBe(1);
    });

    it("counts send failures without halting execution", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(liveExecution);
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA, contactB]);
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProvider.send
        .mockResolvedValueOnce({ messageId: "m1", status: "SENT" })
        .mockRejectedValueOnce(new Error("provider timeout"));
      mockPrisma.campaignTouch.create.mockResolvedValue({});

      const result = await service.execute("exec-001");

      expect(result.sent).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.status).toBe("COMPLETED");
    });

    it("records CampaignTouch for each sent email", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(liveExecution);
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockResolvedValue([contactA]);
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProvider.send.mockResolvedValue({
        messageId: "m",
        status: "SENT",
      });
      mockPrisma.campaignTouch.create.mockResolvedValue({});

      await service.execute("exec-001");

      expect(mockPrisma.campaignTouch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            touchType: "SEND",
            contactId: contactA.id,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate execution guard
  // -------------------------------------------------------------------------
  describe("duplicate execution guard", () => {
    it("rejects execute when status is not PENDING", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue({
        ...pendingExecution,
        status: "COMPLETED",
      });
      await expect(service.execute("exec-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects execute when status is RUNNING", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue({
        ...pendingExecution,
        status: "RUNNING",
      });
      await expect(service.execute("exec-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Campaign state re-check at execution time
  // -------------------------------------------------------------------------
  describe("campaign state re-check", () => {
    it("rejects when campaign was revoked after execution created", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue({
        ...pendingExecution,
        campaign: { ...approvedCampaign, status: "CANCELLED" },
      });
      await expect(service.execute("exec-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Segment-scoped execution
  // -------------------------------------------------------------------------
  describe("segment-scoped execution", () => {
    const segmentedExecution = {
      ...pendingExecution,
      campaign: { ...approvedCampaign, segmentId: "seg-001" },
    };

    it("fetches members from segment rather than all contacts", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        segmentedExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockPrisma.segment.findUnique.mockResolvedValue({
        id: "seg-001",
        type: "LAPSED_CUSTOMER",
      });
      mockSegmentService.getMembersForSegment.mockResolvedValue([contactA]);
      mockContactService.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);

      const result = await service.execute("exec-001");

      expect(mockSegmentService.getMembersForSegment).toHaveBeenCalledWith(
        "LAPSED_CUSTOMER",
      );
      expect(mockContactService.list).not.toHaveBeenCalled();
      expect(result.snapshot.total).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling — marks FAILED on unexpected error
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("marks execution FAILED if eligibility check throws", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      mockPrisma.campaignExecution.update.mockResolvedValue({});
      mockContactService.list.mockRejectedValue(new Error("DB unavailable"));

      await expect(service.execute("exec-001")).rejects.toThrow(
        "DB unavailable",
      );

      const failCall = mockPrisma.campaignExecution.update.mock.calls.find(
        (c) => c[0].data?.status === "FAILED",
      );
      expect(failCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getExecution / listForCampaign
  // -------------------------------------------------------------------------
  describe("getExecution", () => {
    it("returns execution by id", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(
        pendingExecution,
      );
      const result = await service.getExecution("exec-001");
      expect(result.id).toBe("exec-001");
    });

    it("throws NotFoundException when not found", async () => {
      mockPrisma.campaignExecution.findUnique.mockResolvedValue(null);
      await expect(service.getExecution("bad")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("listForCampaign", () => {
    it("returns executions for campaign", async () => {
      mockPrisma.campaignExecution.findMany.mockResolvedValue([
        pendingExecution,
      ]);
      const result = await service.listForCampaign("camp-001");
      expect(result).toHaveLength(1);
    });
  });
});
