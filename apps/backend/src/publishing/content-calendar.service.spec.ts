/**
 * content-calendar.service.spec.ts
 * M7.5 Content Calendar — chronological list, week view, status mapping.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentCalendarService } from "./content-calendar.service";
import { PrismaService } from "../prisma.service";

const mockPrisma = {
  contentDraft: { findMany: jest.fn() },
  publishRequest: { findMany: jest.fn() },
};

const now = new Date("2026-08-27T10:00:00Z");

const approvedDraft = {
  id: "draft-001",
  headline: "Barrier Repair Guide",
  caption: null,
  channel: "BLOG",
  format: "LONG_FORM",
  status: "APPROVED",
  createdAt: now,
  brief: { topic: "Barrier Repair", channel: "BLOG" },
};

const generatedDraft = {
  id: "draft-002",
  headline: null,
  caption: "Check this out",
  channel: "INSTAGRAM",
  format: "POST",
  status: "GENERATED",
  createdAt: new Date("2026-08-26T09:00:00Z"),
  brief: { topic: "Glow tips", channel: "INSTAGRAM" },
};

const succeededRequest = {
  id: "req-001",
  contentDraftId: "draft-001",
  provider: "wordpress",
  destination: "wordpress:primary",
  status: "SUCCEEDED",
  scheduledAt: null,
  createdAt: now,
  contentDraft: {
    channel: "BLOG",
    headline: "Barrier Repair Guide",
    caption: null,
  },
  publication: {
    status: "LIVE",
    remoteUrl: "https://blog.example.com/barrier-repair",
    publishedAt: now,
  },
};

const scheduledRequest = {
  id: "req-002",
  contentDraftId: "draft-002",
  provider: "postiz",
  destination: "postiz:instagram",
  status: "APPROVED",
  scheduledAt: new Date("2026-09-01T10:00:00Z"),
  createdAt: new Date("2026-08-25T08:00:00Z"),
  contentDraft: {
    channel: "INSTAGRAM",
    headline: null,
    caption: "Check this out",
  },
  publication: null,
};

const failedRequest = {
  id: "req-003",
  contentDraftId: "draft-001",
  provider: "postiz",
  destination: "postiz:facebook",
  status: "FAILED",
  scheduledAt: null,
  createdAt: new Date("2026-08-20T07:00:00Z"),
  contentDraft: { channel: "FACEBOOK", headline: null, caption: null },
  publication: null,
};

describe("ContentCalendarService", () => {
  let service: ContentCalendarService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentCalendarService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ContentCalendarService);
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe("list", () => {
    it("returns combined drafts and publish requests", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([approvedDraft]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([succeededRequest]);

      const items = await service.list();

      expect(items.length).toBe(2);
      const types = items.map((i) => i.type);
      expect(types).toContain("content_draft");
      expect(types).toContain("publish_request");
    });

    it("maps APPROVED draft to APPROVED status", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([approvedDraft]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const items = await service.list();
      expect(items[0].status).toBe("APPROVED");
    });

    it("maps GENERATED draft to DRAFT status", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([generatedDraft]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const items = await service.list();
      expect(items[0].status).toBe("DRAFT");
    });

    it("maps SUCCEEDED + LIVE publication to PUBLISHED", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([succeededRequest]);

      const items = await service.list();
      expect(items[0].status).toBe("PUBLISHED");
      expect(items[0].remoteUrl).toBe(
        "https://blog.example.com/barrier-repair",
      );
    });

    it("maps APPROVED request with scheduledAt to SCHEDULED", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([scheduledRequest]);

      const items = await service.list();
      expect(items[0].status).toBe("SCHEDULED");
      expect(items[0].scheduledAt).toEqual(scheduledRequest.scheduledAt);
    });

    it("maps FAILED request to FAILED status", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([failedRequest]);

      const items = await service.list();
      expect(items[0].status).toBe("FAILED");
    });

    it("filters by status when provided", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([
        approvedDraft,
        generatedDraft,
      ]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const items = await service.list({ status: "APPROVED" });
      expect(items.every((i) => i.status === "APPROVED")).toBe(true);
    });

    it("filters by provider when provided", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([
        succeededRequest,
        scheduledRequest,
      ]);

      const items = await service.list({ provider: "wordpress" });
      expect(items.every((i) => i.provider === "wordpress")).toBe(true);
    });

    it("uses headline as title for drafts", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([approvedDraft]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const items = await service.list();
      expect(items[0].title).toBe("Barrier Repair Guide");
    });

    it("falls back to caption when no headline", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([generatedDraft]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const items = await service.list();
      expect(items[0].title).toBe("Check this out");
    });

    it("includes contentDraftId for publish requests", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([succeededRequest]);

      const items = await service.list();
      expect(items[0].contentDraftId).toBe("draft-001");
      expect(items[0].publishRequestId).toBe("req-001");
    });

    it("returns empty list when no data", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const items = await service.list();
      expect(items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getWeek
  // -------------------------------------------------------------------------
  describe("getWeek", () => {
    it("returns items within the specified week", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([approvedDraft]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([scheduledRequest]);

      // Week containing 2026-08-27 (approvedDraft.createdAt)
      const weekStart = new Date("2026-08-24T00:00:00Z");
      const items = await service.getWeek(weekStart);

      const ids = items.map((i) => i.id);
      expect(ids).toContain("draft-001"); // created 2026-08-27
      expect(ids).not.toContain("req-002"); // scheduled 2026-09-01
    });

    it("returns items scheduled in the specified week", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([scheduledRequest]);

      // Week containing 2026-09-01
      const weekStart = new Date("2026-08-31T00:00:00Z");
      const items = await service.getWeek(weekStart);

      expect(items.map((i) => i.id)).toContain("req-002");
    });

    it("returns empty list for a week with no items", async () => {
      mockPrisma.contentDraft.findMany.mockResolvedValue([]);
      mockPrisma.publishRequest.findMany.mockResolvedValue([]);

      const weekStart = new Date("2020-01-01T00:00:00Z");
      const items = await service.getWeek(weekStart);
      expect(items).toHaveLength(0);
    });
  });
});
