import { PerformanceIngestionService } from "./performance-ingestion.service";
import type { PerformanceProvider } from "./performance-provider.interface";

function makePrisma() {
  return {
    performanceObservation: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function mockProvider(
  overrides: Partial<PerformanceProvider> & {
    key: string;
    collectResult?: any;
  },
): PerformanceProvider {
  return {
    key: overrides.key,
    collect: jest.fn().mockResolvedValue(
      overrides.collectResult ?? {
        provider: overrides.key,
        status: "AVAILABLE",
        observations: [],
        detail: null,
      },
    ),
  };
}

describe("PerformanceIngestionService", () => {
  // F — Duplicate observation sync
  it("F: upserts the same metric bucket — no double counting", async () => {
    const prisma = makePrisma();
    const obs = {
      provider: "ga4",
      subjectType: "BRAND",
      subjectId: "brand-1",
      metric: "sessions",
      dimension: "TRAFFIC",
      value: 42,
      unit: "COUNT",
      bucketStart: new Date("2026-08-20T00:00:00Z"),
      bucketEnd: new Date("2026-08-21T00:00:00Z"),
    };
    const provider = mockProvider({
      key: "ga4",
      collectResult: {
        provider: "ga4",
        status: "AVAILABLE",
        observations: [obs, { ...obs, value: 42 }],
        detail: null,
      },
    });
    const svc = new PerformanceIngestionService(prisma as any, [provider]);
    await svc.ingest({
      since: new Date("2026-08-20T00:00:00Z"),
      until: new Date("2026-08-21T00:00:00Z"),
    });
    expect(prisma.performanceObservation.upsert).toHaveBeenCalledTimes(2);
    for (const call of prisma.performanceObservation.upsert.mock.calls) {
      expect(call[0].where).toEqual({
        brandId_provider_subjectType_subjectId_metric_bucketStart: {
          brandId: "luminesce-brand-001",
          provider: "ga4",
          subjectType: "BRAND",
          subjectId: "brand-1",
          metric: "sessions",
          bucketStart: obs.bucketStart,
        },
      });
    }
  });

  it("isolates provider failures — one ERROR does not block others", async () => {
    const prisma = makePrisma();
    const good = mockProvider({
      key: "shopify",
      collectResult: {
        provider: "shopify",
        status: "AVAILABLE",
        observations: [
          {
            provider: "shopify",
            subjectType: "BRAND",
            subjectId: "b",
            metric: "revenue",
            dimension: "REVENUE",
            value: 10,
            unit: "CURRENCY",
            currencyCode: "USD",
            bucketStart: new Date(),
            bucketEnd: new Date(),
          },
        ],
        detail: null,
      },
    });
    const bad: PerformanceProvider = {
      key: "ga4",
      collect: jest.fn().mockRejectedValue(new Error("timeout")),
    };
    const svc = new PerformanceIngestionService(prisma as any, [bad, good]);
    const summary = await svc.ingest();
    expect(summary.providers.find((p) => p.provider === "ga4")?.status).toBe(
      "ERROR",
    );
    expect(
      summary.providers.find((p) => p.provider === "shopify")?.ingested,
    ).toBe(1);
  });

  // J — Mock provider data
  it("J: getObservations excludes mocks by default", async () => {
    const prisma = makePrisma();
    const svc = new PerformanceIngestionService(prisma as any, []);
    await svc.getObservations({
      subjectType: "PUBLICATION",
      subjectId: "pub-1",
    });
    expect(prisma.performanceObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isMock: false }),
      }),
    );
  });

  it("J: listBrandObservations never returns mock rows", async () => {
    const prisma = makePrisma();
    const svc = new PerformanceIngestionService(prisma as any, []);
    await svc.listBrandObservations({ since: new Date() });
    expect(prisma.performanceObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subjectType: "BRAND",
          isMock: false,
        }),
      }),
    );
  });

  it("persists isMock=true when a mock provider emits observations", async () => {
    const prisma = makePrisma();
    const provider = mockProvider({
      key: "ga4",
      collectResult: {
        provider: "ga4",
        status: "MOCK",
        observations: [
          {
            provider: "ga4",
            subjectType: "BRAND",
            subjectId: "b",
            metric: "sessions",
            dimension: "TRAFFIC",
            value: 0,
            unit: "COUNT",
            bucketStart: new Date(),
            bucketEnd: new Date(),
            isMock: true,
            dataQuality: "UNAVAILABLE",
          },
        ],
        detail: "mock",
      },
    });
    const svc = new PerformanceIngestionService(prisma as any, [provider]);
    await svc.ingest();
    expect(
      prisma.performanceObservation.upsert.mock.calls[0][0].create.isMock,
    ).toBe(true);
  });
});
