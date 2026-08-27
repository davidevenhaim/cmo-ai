/**
 * publishing.service.spec.ts
 * M6.7 Publishing Domain — request lifecycle, idempotency, safety gates.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { PublishingService } from "./publishing.service";
import { PrismaService } from "../prisma.service";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  contentDraft: { findUnique: jest.fn() },
  publishRequest: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  publication: { upsert: jest.fn() },
};

// ---------------------------------------------------------------------------
// Stub publisher
// ---------------------------------------------------------------------------
const mockPublisher = {
  provider: "test-provider",
  health: jest.fn(),
  validateDraft: jest.fn(),
  createRemoteDraft: jest.fn(),
  updateRemoteDraft: jest.fn(),
  publish: jest.fn(),
  getPublication: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const approvedDraft = {
  id: "draft-001",
  brandId: "luminesce-brand-001",
  status: "APPROVED",
  content: { title: "Hello", body: "World" },
};

const pendingRequest = {
  id: "req-001",
  brandId: "luminesce-brand-001",
  contentDraftId: "draft-001",
  provider: "test-provider",
  destination: "test-provider:primary",
  status: "PENDING",
  retryCount: 0,
  providerMetadata: null,
  publication: null,
  contentDraft: approvedDraft,
};

const approvedRequest = {
  ...pendingRequest,
  status: "APPROVED",
  approvedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
describe("PublishingService", () => {
  let service: PublishingService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(PublishingService);
    service.registerPublisher(mockPublisher);
    // Default: atomic APPROVED → EXECUTING claim succeeds
    mockPrisma.publishRequest.updateMany.mockResolvedValue({ count: 1 });
  });

  // -------------------------------------------------------------------------
  // createRequest
  // -------------------------------------------------------------------------
  describe("createRequest", () => {
    it("creates request when draft is APPROVED", async () => {
      mockPrisma.contentDraft.findUnique.mockResolvedValue(approvedDraft);
      mockPrisma.publishRequest.create.mockResolvedValue(pendingRequest);

      const result = await service.createRequest({
        contentDraftId: "draft-001",
        provider: "test-provider",
        destination: "test-provider:primary",
      });

      expect(mockPrisma.publishRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PENDING" }),
        }),
      );
      expect(result.status).toBe("PENDING");
    });

    it("rejects when draft not found", async () => {
      mockPrisma.contentDraft.findUnique.mockResolvedValue(null);
      await expect(
        service.createRequest({
          contentDraftId: "bad",
          provider: "p",
          destination: "d",
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects when draft is not APPROVED", async () => {
      mockPrisma.contentDraft.findUnique.mockResolvedValue({
        ...approvedDraft,
        status: "GENERATED",
      });
      await expect(
        service.createRequest({
          contentDraftId: "draft-001",
          provider: "p",
          destination: "d",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects when draft is PENDING_REVIEW", async () => {
      mockPrisma.contentDraft.findUnique.mockResolvedValue({
        ...approvedDraft,
        status: "PENDING_REVIEW",
      });
      await expect(
        service.createRequest({
          contentDraftId: "draft-001",
          provider: "p",
          destination: "d",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // approve
  // -------------------------------------------------------------------------
  describe("approve", () => {
    it("transitions PENDING → APPROVED", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(pendingRequest);
      mockPrisma.publishRequest.update.mockResolvedValue(approvedRequest);

      const result = await service.approve("req-001");

      expect(mockPrisma.publishRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "APPROVED" }),
        }),
      );
      expect(result.status).toBe("APPROVED");
    });

    it("rejects when request not found", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(null);
      await expect(service.approve("bad")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rejects approve on already-APPROVED request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(approvedRequest);
      await expect(service.approve("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects approve on SUCCEEDED request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        status: "SUCCEEDED",
      });
      await expect(service.approve("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------
  describe("execute", () => {
    it("executes APPROVED request via publisher", async () => {
      const publishResult = {
        remoteId: "wp-42",
        remoteUrl: "https://example.com/blog/post",
        status: "LIVE",
      };
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        publication: null,
      });
      mockPrisma.publishRequest.update.mockResolvedValue({
        ...approvedRequest,
        status: "SUCCEEDED",
      });
      mockPublisher.createRemoteDraft.mockResolvedValue(publishResult);
      mockPrisma.publication.upsert.mockResolvedValue({});

      const result = await service.execute("req-001");

      expect(result.status).toBe("LIVE");
      expect(result.remoteId).toBe("wp-42");
      expect(mockPublisher.createRemoteDraft).toHaveBeenCalledWith(
        approvedDraft.content,
        expect.any(Object),
      );
    });

    it("is idempotent — SUCCEEDED request returns existing publication", async () => {
      const existingPub = {
        remoteId: "wp-42",
        remoteUrl: "https://example.com",
        status: "LIVE",
        metadata: {},
      };
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        status: "SUCCEEDED",
        publication: existingPub,
      });

      const result = await service.execute("req-001");

      expect(mockPublisher.createRemoteDraft).not.toHaveBeenCalled();
      expect(result.status).toBe("LIVE");
    });

    it("rejects execute on PENDING (not approved) request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(pendingRequest);
      await expect(service.execute("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects execute when draft is no longer APPROVED", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: { ...approvedDraft, status: "REJECTED" },
        publication: null,
      });
      await expect(service.execute("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("marks FAILED and records publication on publisher error", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        publication: null,
      });
      mockPublisher.createRemoteDraft.mockRejectedValue(
        new Error("Remote 503"),
      );
      mockPrisma.publishRequest.update.mockResolvedValue({});
      mockPrisma.publication.upsert.mockResolvedValue({});

      await expect(service.execute("req-001")).rejects.toThrow("Remote 503");

      expect(mockPrisma.publishRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });

    it("marks request FAILED (never SUCCEEDED) when provider returns FAILED result without throwing", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        publication: null,
      });
      mockPublisher.createRemoteDraft.mockResolvedValue({
        status: "FAILED",
        error: "WP rejected payload",
      });
      mockPrisma.publishRequest.update.mockResolvedValue({});
      mockPrisma.publication.upsert.mockResolvedValue({});

      const result = await service.execute("req-001");

      expect(result.status).toBe("FAILED");
      const statuses = mockPrisma.publishRequest.update.mock.calls.map(
        (c) => c[0].data?.status,
      );
      expect(statuses).toContain("FAILED");
      expect(statuses).not.toContain("SUCCEEDED");
      const failedUpdate = mockPrisma.publishRequest.update.mock.calls.find(
        (c) => c[0].data?.status === "FAILED",
      );
      expect(failedUpdate[0].data.failureReason).toBe("WP rejected payload");
    });

    it("preserves UNKNOWN when provider outcome is uncertain and no remoteId to reconcile", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        publication: null,
      });
      mockPublisher.createRemoteDraft.mockResolvedValue({ status: "UNKNOWN" });
      mockPrisma.publishRequest.update.mockResolvedValue({});
      mockPrisma.publication.upsert.mockResolvedValue({});

      const result = await service.execute("req-001");

      expect(result.status).toBe("UNKNOWN");
      const statuses = mockPrisma.publishRequest.update.mock.calls.map(
        (c) => c[0].data?.status,
      );
      expect(statuses).toContain("UNKNOWN");
      expect(statuses).not.toContain("SUCCEEDED");
      expect(statuses).not.toContain("FAILED");
      // No blind retry
      expect(mockPublisher.createRemoteDraft).toHaveBeenCalledTimes(1);
    });

    it("reconciles UNKNOWN via getPublication when remoteId is known — no re-send", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        providerMetadata: { remoteId: "wp-77" },
        publication: null,
      });
      mockPublisher.publish.mockResolvedValue({ status: "UNKNOWN" });
      mockPublisher.getPublication.mockResolvedValue({
        remoteId: "wp-77",
        status: "LIVE",
        remoteUrl: "https://example.com/p",
      });
      mockPrisma.publishRequest.update.mockResolvedValue({});
      mockPrisma.publication.upsert.mockResolvedValue({});

      const result = await service.execute("req-001");

      expect(mockPublisher.getPublication).toHaveBeenCalledWith("wp-77");
      expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("LIVE");
      const statuses = mockPrisma.publishRequest.update.mock.calls.map(
        (c) => c[0].data?.status,
      );
      expect(statuses).toContain("SUCCEEDED");
    });

    it("concurrent execute: loser of atomic claim never calls provider", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        publication: null,
      });
      // Another executor already claimed APPROVED → EXECUTING
      mockPrisma.publishRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.execute("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPublisher.createRemoteDraft).not.toHaveBeenCalled();
      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });

    it("concurrent execute: loser returns existing publication when winner already SUCCEEDED", async () => {
      const existingPub = {
        remoteId: "wp-42",
        remoteUrl: "https://example.com",
        status: "LIVE",
        metadata: {},
      };
      mockPrisma.publishRequest.findUnique
        .mockResolvedValueOnce({ ...approvedRequest, publication: null })
        .mockResolvedValueOnce({
          ...approvedRequest,
          status: "SUCCEEDED",
          publication: existingPub,
        });
      mockPrisma.publishRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.execute("req-001");

      expect(result.status).toBe("LIVE");
      expect(mockPublisher.createRemoteDraft).not.toHaveBeenCalled();
    });

    it("uses existing remoteId for re-publish when providerMetadata contains one", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        providerMetadata: { remoteId: "wp-draft-10" },
        publication: null,
      });
      mockPublisher.publish.mockResolvedValue({
        status: "LIVE",
        remoteId: "wp-draft-10",
      });
      mockPrisma.publishRequest.update.mockResolvedValue({});
      mockPrisma.publication.upsert.mockResolvedValue({});

      const result = await service.execute("req-001");

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        "wp-draft-10",
        expect.anything(),
      );
      expect(mockPublisher.createRemoteDraft).not.toHaveBeenCalled();
      expect(result.status).toBe("LIVE");
    });

    it("rejects execute on unknown provider", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        provider: "nonexistent-provider",
        publication: null,
      });
      await expect(service.execute("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("throws NotFoundException when request does not exist", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(null);
      await expect(service.execute("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // reconcile
  // -------------------------------------------------------------------------
  describe("reconcile", () => {
    const unknownRequest = {
      ...approvedRequest,
      status: "UNKNOWN",
      providerMetadata: { remoteId: "wp-77" },
      publication: null,
    };

    it("rejects reconcile on non-UNKNOWN request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(approvedRequest);
      await expect(service.reconcile("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("resolves UNKNOWN → SUCCEEDED when remote lookup confirms LIVE", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(unknownRequest);
      mockPublisher.getPublication.mockResolvedValue({
        remoteId: "wp-77",
        status: "LIVE",
      });
      mockPrisma.publishRequest.update.mockResolvedValue({});
      mockPrisma.publication.upsert.mockResolvedValue({});

      const result = await service.reconcile("req-001");

      expect(result.status).toBe("LIVE");
      expect(mockPrisma.publishRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SUCCEEDED" }),
        }),
      );
      // Reconciliation must not re-send
      expect(mockPublisher.publish).not.toHaveBeenCalled();
      expect(mockPublisher.createRemoteDraft).not.toHaveBeenCalled();
    });

    it("remains UNKNOWN when remote state cannot be resolved", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(unknownRequest);
      mockPublisher.getPublication.mockResolvedValue(null);

      const result = await service.reconcile("req-001");

      expect(result.status).toBe("UNKNOWN");
      expect(mockPrisma.publishRequest.update).not.toHaveBeenCalled();
    });

    it("remains UNKNOWN when no remote identifier exists", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...unknownRequest,
        providerMetadata: null,
      });

      const result = await service.reconcile("req-001");

      expect(result.status).toBe("UNKNOWN");
      expect(mockPublisher.getPublication).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------
  describe("cancel", () => {
    it("cancels PENDING request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(pendingRequest);
      mockPrisma.publishRequest.update.mockResolvedValue({
        ...pendingRequest,
        status: "FAILED",
        failureReason: "Cancelled by owner",
      });

      const result = await service.cancel("req-001");
      expect(result.failureReason).toBe("Cancelled by owner");
    });

    it("cancels APPROVED request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(approvedRequest);
      mockPrisma.publishRequest.update.mockResolvedValue({
        ...approvedRequest,
        status: "FAILED",
      });

      await service.cancel("req-001");
      expect(mockPrisma.publishRequest.update).toHaveBeenCalled();
    });

    it("rejects cancel on EXECUTING request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        status: "EXECUTING",
      });
      await expect(service.cancel("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects cancel on SUCCEEDED request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        status: "SUCCEEDED",
      });
      await expect(service.cancel("req-001")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("throws NotFoundException when request not found", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(null);
      await expect(service.cancel("bad")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // dryRun
  // -------------------------------------------------------------------------
  describe("dryRun", () => {
    it("returns wouldExecute=true for valid approved request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: approvedDraft,
      });
      mockPublisher.validateDraft.mockResolvedValue({
        valid: true,
        errors: [],
      });

      const result = await service.dryRun("req-001");

      expect(result.wouldExecute).toBe(true);
      expect(result.validation.valid).toBe(true);
    });

    it("returns wouldExecute=false when draft not APPROVED", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: { ...approvedDraft, status: "GENERATED" },
      });

      const result = await service.dryRun("req-001");

      expect(result.wouldExecute).toBe(false);
      expect(result.reason).toContain("GENERATED");
    });

    it("returns wouldExecute=false when request not APPROVED", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        contentDraft: approvedDraft,
      });

      const result = await service.dryRun("req-001");

      expect(result.wouldExecute).toBe(false);
      expect(result.reason).toContain("PENDING");
    });

    it("returns wouldExecute=false when validation fails", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: approvedDraft,
      });
      mockPublisher.validateDraft.mockResolvedValue({
        valid: false,
        errors: ["Missing title"],
      });

      const result = await service.dryRun("req-001");

      expect(result.wouldExecute).toBe(false);
      expect(result.reason).toContain("Missing title");
    });

    it("returns wouldExecute=false for unknown provider", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        provider: "unknown",
        contentDraft: approvedDraft,
      });

      const result = await service.dryRun("req-001");

      expect(result.wouldExecute).toBe(false);
      expect(result.reason).toContain("No publisher registered");
    });

    it("does not call execute or create remote draft", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: approvedDraft,
      });
      mockPublisher.validateDraft.mockResolvedValue({
        valid: true,
        errors: [],
      });

      await service.dryRun("req-001");

      expect(mockPublisher.createRemoteDraft).not.toHaveBeenCalled();
      expect(mockPublisher.publish).not.toHaveBeenCalled();
      expect(mockPrisma.publishRequest.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // listRequests / getRequest
  // -------------------------------------------------------------------------
  describe("listRequests", () => {
    it("lists requests with no filters", async () => {
      mockPrisma.publishRequest.findMany.mockResolvedValue([pendingRequest]);
      const result = await service.listRequests();
      expect(result).toHaveLength(1);
    });

    it("filters by status", async () => {
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);
      await service.listRequests({ status: "SUCCEEDED" });
      expect(mockPrisma.publishRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "SUCCEEDED" }),
        }),
      );
    });

    it("filters by provider", async () => {
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);
      await service.listRequests({ provider: "wordpress" });
      expect(mockPrisma.publishRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ provider: "wordpress" }),
        }),
      );
    });
  });

  describe("getRequest", () => {
    it("returns request with publication", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(pendingRequest);
      const result = await service.getRequest("req-001");
      expect(result.id).toBe("req-001");
    });

    it("throws NotFoundException when not found", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(null);
      await expect(service.getRequest("bad")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // M7.3 safetyCheck
  // -------------------------------------------------------------------------
  describe("safetyCheck", () => {
    it("returns safe=true for a fully valid APPROVED request", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: approvedDraft,
        publication: null,
      });

      const result = await service.safetyCheck("req-001");
      expect(result.safe).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("reports violation when request not found", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue(null);
      const result = await service.safetyCheck("bad");
      expect(result.safe).toBe(false);
      expect(result.violations[0]).toContain("not found");
    });

    it("reports violation when draft not APPROVED", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        contentDraft: { ...approvedDraft, status: "GENERATED" },
        publication: null,
      });
      const result = await service.safetyCheck("req-001");
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("GENERATED"))).toBe(true);
    });

    it("reports violation when request not APPROVED", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        contentDraft: approvedDraft,
        publication: null,
      });
      const result = await service.safetyCheck("req-001");
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("PENDING"))).toBe(true);
    });

    it("reports violation when provider not registered", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        provider: "unknown-provider",
        contentDraft: approvedDraft,
        publication: null,
      });
      const result = await service.safetyCheck("req-001");
      expect(result.safe).toBe(false);
      expect(
        result.violations.some((v) => v.includes("unknown-provider")),
      ).toBe(true);
    });

    it("reports violation when already SUCCEEDED — duplicate guard", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...approvedRequest,
        status: "SUCCEEDED",
        contentDraft: approvedDraft,
        publication: { status: "LIVE" },
      });
      const result = await service.safetyCheck("req-001");
      expect(result.safe).toBe(false);
      expect(result.violations.some((v) => v.includes("duplicate"))).toBe(true);
    });

    it("can accumulate multiple violations", async () => {
      mockPrisma.publishRequest.findUnique.mockResolvedValue({
        ...pendingRequest,
        provider: "unknown-provider",
        contentDraft: { ...approvedDraft, status: "GENERATED" },
        publication: null,
      });
      const result = await service.safetyCheck("req-001");
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // registerPublisher / getPublisher
  // -------------------------------------------------------------------------
  describe("registerPublisher", () => {
    it("throws BadRequestException for unknown provider", () => {
      expect(() => service.getPublisher("nonexistent")).toThrow(
        BadRequestException,
      );
    });

    it("returns registered publisher", () => {
      const publisher = service.getPublisher("test-provider");
      expect(publisher.provider).toBe("test-provider");
    });
  });
});
