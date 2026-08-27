import { Test, TestingModule } from "@nestjs/testing";
import { ApprovalService } from "./approval.service";
import { PrismaService } from "../prisma.service";
import { NotFoundException } from "@nestjs/common";

const now = new Date();
const fakeApproval = {
  id: "approval-001",
  brandId: "luminesce-brand-001",
  cmoRunId: "run-001",
  type: "GENERAL",
  subject: "Test subject",
  description: "Test description",
  status: "PENDING",
  resolvedAt: null,
  resolvedBy: null,
  metadata: null,
  createdAt: now,
  updatedAt: now,
};

const mockPrisma: any = {
  approval: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  contentDraft: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
};

describe("ApprovalService", () => {
  let service: ApprovalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ApprovalService>(ApprovalService);
    jest.clearAllMocks();
  });

  it("create persists approval with PENDING status", async () => {
    mockPrisma.approval.create.mockResolvedValue(fakeApproval);
    await service.create({
      type: "GENERAL",
      subject: "Test subject",
      description: "Test description",
    });
    expect(mockPrisma.approval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  describe("resolve", () => {
    it("atomic updateMany when PENDING — updates and returns record", async () => {
      const resolved = {
        ...fakeApproval,
        status: "APPROVED",
        resolvedBy: "telegram",
      };
      mockPrisma.approval.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approval.findUniqueOrThrow.mockResolvedValue(resolved);

      const result = await service.resolve(
        "approval-001",
        "APPROVED",
        "telegram",
      );

      expect(mockPrisma.approval.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "approval-001", status: "PENDING" },
          data: expect.objectContaining({
            status: "APPROVED",
            resolvedBy: "telegram",
          }),
        }),
      );
      expect(result.status).toBe("APPROVED");
    });

    it("idempotent: returns existing record when already resolved (count=0)", async () => {
      const alreadyApproved = { ...fakeApproval, status: "APPROVED" };
      mockPrisma.approval.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.approval.findUnique.mockResolvedValue(alreadyApproved);

      const result = await service.resolve("approval-001", "REJECTED", "api");

      expect(mockPrisma.approval.update).not.toHaveBeenCalled();
      expect(result.status).toBe("APPROVED");
    });

    it("approving transitions linked ContentDraft to APPROVED in same transaction", async () => {
      mockPrisma.approval.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.contentDraft.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approval.findUniqueOrThrow.mockResolvedValue({
        ...fakeApproval,
        status: "APPROVED",
      });

      await service.resolve("approval-001", "APPROVED", "telegram");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.contentDraft.updateMany).toHaveBeenCalledWith({
        where: {
          approvalId: "approval-001",
          status: { in: ["GENERATED", "PENDING_REVIEW"] },
        },
        data: { status: "APPROVED" },
      });
    });

    it("rejecting transitions linked ContentDraft to REJECTED", async () => {
      mockPrisma.approval.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.contentDraft.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approval.findUniqueOrThrow.mockResolvedValue({
        ...fakeApproval,
        status: "REJECTED",
      });

      await service.resolve("approval-001", "REJECTED", "api");

      expect(mockPrisma.contentDraft.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "REJECTED" } }),
      );
    });

    it("concurrent resolve: loser (count=0) does not touch ContentDraft", async () => {
      mockPrisma.approval.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.approval.findUnique.mockResolvedValue({
        ...fakeApproval,
        status: "APPROVED",
      });

      const result = await service.resolve("approval-001", "REJECTED", "api");

      expect(mockPrisma.contentDraft.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe("APPROVED");
    });

    it("throws NotFoundException when approval not found after count=0", async () => {
      mockPrisma.approval.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.approval.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve("missing", "APPROVED", "api"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it("getById throws NotFoundException when not found", async () => {
    mockPrisma.approval.findUnique.mockResolvedValue(null);
    await expect(service.getById("missing-id")).rejects.toThrow(
      NotFoundException,
    );
  });
});
