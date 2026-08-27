import { Test, TestingModule } from "@nestjs/testing";
import { ContentService } from "./content.service";
import { PrismaService } from "../prisma.service";

const mockPrisma = {
  contentDraft: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  contentBrief: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  contentFeedback: {
    create: jest.fn(),
  },
};

describe("ContentService", () => {
  let service: ContentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ContentService>(ContentService);
    jest.clearAllMocks();
  });

  it("createDraft creates draft as GENERATED", async () => {
    mockPrisma.contentDraft.create.mockResolvedValue({ id: "draft-1" });
    await service.createDraft({
      briefId: "brief-1",
      version: 1,
      channel: "BLOG",
      format: "ARTICLE",
      content: {},
      hashtags: [],
      generationMetadata: {},
    });
    expect(mockPrisma.contentDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "GENERATED" }),
      }),
    );
  });

  it("linkApprovalToDraft transitions final draft to PENDING_REVIEW", async () => {
    mockPrisma.contentDraft.update.mockResolvedValue({
      id: "draft-1",
      status: "PENDING_REVIEW",
    });
    await service.linkApprovalToDraft("draft-1", "approval-1");
    expect(mockPrisma.contentDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { approvalId: "approval-1", status: "PENDING_REVIEW" },
    });
  });

  it("listPendingDrafts returns PENDING_REVIEW drafts (reviewable)", async () => {
    const pending = [{ id: "draft-1", status: "PENDING_REVIEW" }];
    mockPrisma.contentDraft.findMany.mockResolvedValue(pending);
    const result = await service.listPendingDrafts();
    expect(mockPrisma.contentDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING_REVIEW" }),
      }),
    );
    expect(result).toEqual(pending);
  });

  it("supersedePreviousDrafts marks older versions SUPERSEDED", async () => {
    mockPrisma.contentDraft.updateMany.mockResolvedValue({ count: 2 });
    await service.supersedePreviousDrafts("brief-1", 3);
    expect(mockPrisma.contentDraft.updateMany).toHaveBeenCalledWith({
      where: {
        briefId: "brief-1",
        version: { lt: 3 },
        status: { not: "SUPERSEDED" },
      },
      data: { status: "SUPERSEDED" },
    });
  });
});
