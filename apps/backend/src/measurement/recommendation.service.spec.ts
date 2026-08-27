import { RecommendationService } from "./recommendation.service";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

function makePrisma() {
  return {
    recommendation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: "rec-new", ...data })),
      update: jest.fn(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contentBrief: { update: jest.fn() },
    revenueOpportunity: { update: jest.fn() },
  };
}

const baseInput = {
  type: "CREATE_CONTENT",
  title: "Create content: Product A guide",
  rationale: "Market signal for Product A",
  confidence: 0.8,
  actionClass: "PROPOSE" as const,
  targetType: "MARKET_OPPORTUNITY",
  targetId: "opp-1",
};

describe("RecommendationService.propose", () => {
  it("persists with the default measurement window and dedupe key", async () => {
    const prisma = makePrisma();
    const svc = new RecommendationService(prisma as any);
    await svc.propose(baseInput);
    expect(prisma.recommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupeKey: "CREATE_CONTENT:MARKET_OPPORTUNITY:opp-1",
          measurementWindowDays: MEASUREMENT_POLICY.defaultWindowDays,
          type: "CREATE_CONTENT",
          title: "Create content: Product A guide",
        }),
      }),
    );
    // Status defaults to PROPOSED in the Prisma schema — not set on create.
    expect(
      prisma.recommendation.create.mock.calls[0][0].data.status,
    ).toBeUndefined();
  });

  it("is idempotent while a matching proposal is still open", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findFirst.mockResolvedValue({ id: "rec-existing" });
    const svc = new RecommendationService(prisma as any);
    const result = await svc.propose(baseInput);
    expect(result.id).toBe("rec-existing");
    expect(prisma.recommendation.create).not.toHaveBeenCalled();
    expect(prisma.recommendation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PROPOSED", "APPROVED", "EXECUTED", "MEASURING"] },
        }),
      }),
    );
  });
});

describe("RecommendationService.decide", () => {
  it("only PROPOSED recommendations can be decided", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "EXECUTED",
    });
    const svc = new RecommendationService(prisma as any);
    await expect(svc.decide("rec-1", { status: "APPROVED" })).rejects.toThrow(
      /only PROPOSED/,
    );
  });

  it("stores the structured rejection reason and note — rejection is data", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "PROPOSED",
    });
    const svc = new RecommendationService(prisma as any);
    await svc.decide("rec-1", {
      status: "REJECTED",
      rejectionReason: "BAD_TIMING",
      rejectionNote: "Campaign A launches next month",
    });
    expect(prisma.recommendation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REJECTED",
          rejectionReason: "BAD_TIMING",
          rejectionNote: "Campaign A launches next month",
        }),
      }),
    );
  });

  it("never stores rejection fields on approval", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "PROPOSED",
    });
    const svc = new RecommendationService(prisma as any);
    await svc.decide("rec-1", { status: "APPROVED" });
    const data = prisma.recommendation.update.mock.calls[0][0].data;
    expect(data.rejectionReason).toBeNull();
    expect(data.rejectionNote).toBeNull();
  });

  it("throws NotFound for a missing recommendation", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findUnique.mockResolvedValue(null);
    const svc = new RecommendationService(prisma as any);
    await expect(svc.decide("nope", { status: "APPROVED" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("RecommendationService.markExecuted", () => {
  it("starts the measurement window at execution time", async () => {
    const prisma = makePrisma();
    const executedAt = new Date("2026-08-20T10:00:00Z");
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "APPROVED",
      decidedAt: null,
      measurementWindowDays: 7,
    });
    const svc = new RecommendationService(prisma as any);
    await svc.markExecuted("rec-1", executedAt);
    const data = prisma.recommendation.update.mock.calls[0][0].data;
    expect(data.status).toBe("EXECUTED");
    expect(data.executedAt).toEqual(executedAt);
    expect(data.measurementWindowEndsAt).toEqual(
      new Date("2026-08-27T10:00:00Z"),
    );
  });

  it("is a no-op for statuses past execution — idempotent", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "MEASURED",
    });
    const svc = new RecommendationService(prisma as any);
    const result = await svc.markExecuted("rec-1");
    expect(result.status).toBe("MEASURED");
    expect(prisma.recommendation.update).not.toHaveBeenCalled();
  });
});

describe("RecommendationService.expireStale", () => {
  it("expires only PROPOSED recommendations older than the TTL", async () => {
    const prisma = makePrisma();
    prisma.recommendation.updateMany.mockResolvedValue({ count: 2 });
    const svc = new RecommendationService(prisma as any);
    const now = new Date("2026-08-27T00:00:00Z");
    const count = await svc.expireStale(now);
    expect(count).toBe(2);
    const arg = prisma.recommendation.updateMany.mock.calls[0][0];
    expect(arg.where.status).toBe("PROPOSED");
    expect(arg.where.createdAt.lt).toEqual(
      new Date(
        now.getTime() -
          MEASUREMENT_POLICY.proposalTtlDays * 24 * 60 * 60 * 1000,
      ),
    );
    expect(arg.data).toEqual({ status: "EXPIRED" });
  });
});

describe("RecommendationService.syncExecutionTransitions", () => {
  it("marks executed when a linked publication went LIVE", async () => {
    const prisma = makePrisma();
    const publishedAt = new Date("2026-08-21T09:00:00Z");
    prisma.recommendation.findMany.mockResolvedValue([
      {
        id: "rec-1",
        status: "PROPOSED",
        contentBriefs: [
          {
            drafts: [
              {
                publishRequests: [
                  { publication: { status: "LIVE", publishedAt } },
                ],
              },
            ],
          },
        ],
        revenueOpportunities: [],
      },
    ]);
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-1",
      status: "PROPOSED",
      decidedAt: null,
      measurementWindowDays: 7,
    });
    const svc = new RecommendationService(prisma as any);
    const count = await svc.syncExecutionTransitions();
    expect(count).toBe(1);
    const data = prisma.recommendation.update.mock.calls[0][0].data;
    expect(data.executedAt).toEqual(publishedAt);
  });

  it("marks executed when a linked opportunity has an active journey", async () => {
    const prisma = makePrisma();
    const journeyCreated = new Date("2026-08-22T08:00:00Z");
    prisma.recommendation.findMany.mockResolvedValue([
      {
        id: "rec-2",
        status: "APPROVED",
        contentBriefs: [],
        revenueOpportunities: [{ journey: { createdAt: journeyCreated } }],
      },
    ]);
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-2",
      status: "APPROVED",
      decidedAt: new Date(),
      measurementWindowDays: 7,
    });
    const svc = new RecommendationService(prisma as any);
    const count = await svc.syncExecutionTransitions();
    expect(count).toBe(1);
  });

  it("leaves recommendations without executed lineage untouched", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findMany.mockResolvedValue([
      {
        id: "rec-3",
        status: "PROPOSED",
        contentBriefs: [
          { drafts: [{ publishRequests: [{ publication: null }] }] },
        ],
        revenueOpportunities: [{ journey: null }],
      },
    ]);
    const svc = new RecommendationService(prisma as any);
    const count = await svc.syncExecutionTransitions();
    expect(count).toBe(0);
    expect(prisma.recommendation.update).not.toHaveBeenCalled();
  });
});

describe("RecommendationService lineage links", () => {
  it("links a ContentBrief without replacing the brief entity", async () => {
    const prisma = makePrisma();
    const svc = new RecommendationService(prisma as any);
    await svc.linkContentBrief("rec-1", "brief-a");
    expect(prisma.contentBrief.update).toHaveBeenCalledWith({
      where: { id: "brief-a" },
      data: { recommendationId: "rec-1" },
    });
  });

  it("I: rejected recommendation is retained and never executed", async () => {
    const prisma = makePrisma();
    prisma.recommendation.findUnique.mockResolvedValue({
      id: "rec-rej",
      status: "REJECTED",
      rejectionReason: "BAD_TIMING",
    });
    const svc = new RecommendationService(prisma as any);
    const result = await svc.markExecuted("rec-rej");
    expect(result.status).toBe("REJECTED");
    expect(prisma.recommendation.update).not.toHaveBeenCalled();
  });
});
