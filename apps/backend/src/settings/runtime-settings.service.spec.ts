import { CommerceSettingsSchema, RevenuePolicySchema } from "@ai-cmo/contracts";
import { RuntimeSettingsService } from "./runtime-settings.service";
import {
  CODE_COMMERCE_DEFAULTS,
  CODE_REVENUE_DEFAULTS,
} from "./settings.defaults";

describe("RuntimeSettingsService", () => {
  const brandId = "luminesce-brand-001";

  function mockPrisma(opts?: { commerce?: any; revenue?: any }) {
    return {
      commerceSettings: {
        findUnique: jest.fn().mockResolvedValue(opts?.commerce ?? null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "c1", ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "c1", brandId, ...data }),
          ),
      },
      revenuePolicy: {
        findUnique: jest.fn().mockResolvedValue(opts?.revenue ?? null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "r1", ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: "r1", brandId, ...data }),
          ),
      },
      settingsAuditLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  }

  it("bootstraps defaults once and does not overwrite on ensureBootstrapped", async () => {
    const prisma = mockPrisma();
    const svc = new RuntimeSettingsService(prisma as any);
    await svc.ensureBootstrapped(brandId);
    expect(prisma.commerceSettings.create).toHaveBeenCalledTimes(1);
    expect(prisma.revenuePolicy.create).toHaveBeenCalledTimes(1);

    prisma.commerceSettings.findUnique.mockResolvedValue({
      brandId,
      ...CODE_COMMERCE_DEFAULTS,
    });
    prisma.revenuePolicy.findUnique.mockResolvedValue({
      brandId,
      ...CODE_REVENUE_DEFAULTS,
    });
    await svc.ensureBootstrapped(brandId);
    expect(prisma.commerceSettings.create).toHaveBeenCalledTimes(1);
    expect(prisma.revenuePolicy.create).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid revenue writes", async () => {
    const prisma = mockPrisma({
      commerce: { brandId, ...CODE_COMMERCE_DEFAULTS },
      revenue: { brandId, ...CODE_REVENUE_DEFAULTS },
    });
    const svc = new RuntimeSettingsService(prisma as any);
    await expect(svc.patchRevenue({ maxDiscountPct: 999 })).rejects.toThrow(
      /validation/i,
    );
  });

  it("rejects non-increasing recovery ladder", async () => {
    expect(() =>
      RevenuePolicySchema.parse({
        ...CODE_REVENUE_DEFAULTS,
        recoveryLadderHours: [1, 24, 6],
      }),
    ).toThrow();
  });

  it("accepts valid commerce patch and writes audit", async () => {
    const prisma = mockPrisma({
      commerce: { brandId, ...CODE_COMMERCE_DEFAULTS },
      revenue: { brandId, ...CODE_REVENUE_DEFAULTS },
    });
    const svc = new RuntimeSettingsService(prisma as any);
    const updated = await svc.patchCommerce(
      { lowStockThreshold: 3 },
      { source: "ADMIN_UI", actor: "admin" },
    );
    expect(updated.lowStockThreshold).toBe(3);
    expect(prisma.settingsAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: "COMMERCE",
          field: "lowStockThreshold",
          previousValue: 5,
          newValue: 3,
          source: "ADMIN_UI",
        }),
      }),
    );
  });

  it("persisted values win over code defaults in sync cache after refresh", async () => {
    const prisma = mockPrisma({
      commerce: {
        brandId,
        lowStockThreshold: 2,
        defaultMetricsPeriodDays: 14,
      },
      revenue: {
        brandId,
        ...CODE_REVENUE_DEFAULTS,
        maxDiscountPct: 10,
      },
    });
    const svc = new RuntimeSettingsService(prisma as any);
    await svc.refreshCache(brandId);
    expect(svc.getCommerceSync().lowStockThreshold).toBe(2);
    expect(svc.getRevenueSync().maxDiscountPct).toBe(10);
    expect(CommerceSettingsSchema.parse(svc.getCommerceSync())).toBeTruthy();
  });

  it("never exposes secret keys in settings payloads", async () => {
    const prisma = mockPrisma({
      commerce: { brandId, ...CODE_COMMERCE_DEFAULTS },
      revenue: { brandId, ...CODE_REVENUE_DEFAULTS },
    });
    const svc = new RuntimeSettingsService(prisma as any);
    const all = await svc.getAll(brandId);
    const serialized = JSON.stringify(all);
    expect(serialized).not.toMatch(/API_KEY|TOKEN|PASSWORD|SECRET/i);
  });
});
