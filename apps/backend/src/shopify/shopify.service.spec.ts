import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { ShopifyService } from "./shopify.service";
import { ShopifyGraphqlAdapter } from "./shopify-graphql.adapter";
import { PrismaService } from "../prisma.service";

const now = new Date();

const rawProduct = {
  id: "p1",
  title: "Serum",
  handle: "serum",
  status: "ACTIVE",
  productType: null,
  tags: [],
  totalInventory: 20,
  variants: {
    edges: [
      {
        node: {
          id: "v1",
          title: "Default",
          sku: null,
          price: "68.00",
          compareAtPrice: null,
          inventoryQuantity: 20,
          availableForSale: true,
        },
      },
    ],
  },
  priceRangeV2: {
    minVariantPrice: { amount: "68.00" },
    maxVariantPrice: { amount: "68.00" },
  },
};

const rawOrder = {
  id: "o1",
  createdAt: now.toISOString(),
  cancelledAt: null,
  test: false,
  financialStatus: "paid",
  totalPriceSet: { shopMoney: { amount: "68.00", currencyCode: "USD" } },
  totalRefundedSet: { shopMoney: { amount: "0.00" } },
  email: "test@example.com",
  customer: { numberOfOrders: 1 },
  lineItems: {
    edges: [
      {
        node: {
          product: { id: "p1" },
          title: "Serum",
          quantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: "68.00" } },
        },
      },
    ],
  },
};

const mockAdapter = {
  configured: true,
  fetchProducts: jest.fn(),
  fetchOrders: jest.fn(),
  fetchShopName: jest.fn(),
  fetchCurrencyCode: jest.fn(),
};

const mockPrisma = {
  commerceSnapshot: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      SHOPIFY_DEFAULT_PERIOD_DAYS: "30",
      SHOPIFY_LOW_STOCK_THRESHOLD: "5",
    };
    return map[key];
  }),
};

describe("ShopifyService", () => {
  let service: ShopifyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyService,
        { provide: ShopifyGraphqlAdapter, useValue: mockAdapter },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<ShopifyService>(ShopifyService);
    jest.clearAllMocks();
    mockAdapter.configured = true;
  });

  describe("getCommerceContext", () => {
    it("returns UNAVAILABLE context when not configured", async () => {
      mockAdapter.configured = false;
      const ctx = await service.getCommerceContext();
      expect(ctx.evidenceStatus).toBe("UNAVAILABLE");
      expect(ctx.failureReason).toContain("not configured");
    });

    it("fetches and returns AVAILABLE context when configured", async () => {
      mockAdapter.fetchProducts.mockResolvedValue({
        items: [rawProduct],
        truncated: false,
      });
      mockAdapter.fetchOrders.mockResolvedValue({
        items: [rawOrder],
        truncated: false,
      });
      mockAdapter.fetchShopName.mockResolvedValue("Luminesce Store");
      mockAdapter.fetchCurrencyCode.mockResolvedValue("USD");
      mockPrisma.commerceSnapshot.create.mockResolvedValue({
        id: "snap-001",
        snapshotAt: now,
      });

      const ctx = await service.getCommerceContext();

      expect(ctx.evidenceStatus).toBe("AVAILABLE");
      expect(ctx.shopName).toBe("Luminesce Store");
      expect(ctx.metrics).not.toBeNull();
      expect(ctx.metrics!.revenue).toBe(68);
    });

    it("uses bounded date range: calls fetchOrders twice with non-overlapping ranges", async () => {
      mockAdapter.fetchProducts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockAdapter.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockAdapter.fetchShopName.mockResolvedValue("Shop");
      mockAdapter.fetchCurrencyCode.mockResolvedValue("USD");
      mockPrisma.commerceSnapshot.create.mockResolvedValue({
        id: "snap",
        snapshotAt: now,
      });

      await service.getCommerceContext();

      expect(mockAdapter.fetchOrders).toHaveBeenCalledTimes(2);
      const [call1, call2] = mockAdapter.fetchOrders.mock.calls;
      // Current period: [periodStart, periodEnd]
      const [currentSince, currentUntil] = call1;
      // Previous period: [previousStart, periodStart]
      const [prevSince, prevUntil] = call2;
      expect(currentSince < currentUntil).toBe(true);
      expect(prevSince < prevUntil).toBe(true);
      // Ranges must not overlap
      expect(prevUntil.getTime()).toBeLessThanOrEqual(currentSince.getTime());
    });

    it("returns STALE context when fetch fails but snapshot exists", async () => {
      mockAdapter.fetchProducts.mockRejectedValue(new Error("Network error"));
      mockPrisma.commerceSnapshot.findFirst.mockResolvedValue({
        id: "snap-old",
        snapshotAt: new Date("2024-01-01"),
        available: true,
        shopName: "Luminesce Store",
        metricsJson: null,
        topProductsJson: [],
        failureReason: null,
      });

      const ctx = await service.getCommerceContext();

      expect(ctx.evidenceStatus).toBe("STALE");
      expect(ctx.failureReason).toBe("Network error");
    });

    it("returns UNAVAILABLE when fetch fails and no snapshot exists", async () => {
      mockAdapter.fetchProducts.mockRejectedValue(new Error("Timeout"));
      mockPrisma.commerceSnapshot.findFirst.mockResolvedValue(null);

      const ctx = await service.getCommerceContext();

      expect(ctx.evidenceStatus).toBe("UNAVAILABLE");
    });

    it("sets metricsIncomplete when orders truncated", async () => {
      mockAdapter.fetchProducts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockAdapter.fetchOrders.mockResolvedValue({ items: [], truncated: true });
      mockAdapter.fetchShopName.mockResolvedValue("Shop");
      mockAdapter.fetchCurrencyCode.mockResolvedValue("USD");
      mockPrisma.commerceSnapshot.create.mockResolvedValue({
        id: "snap",
        snapshotAt: now,
      });

      const ctx = await service.getCommerceContext();

      expect(ctx.metrics!.metricsIncomplete).toBe(true);
    });
  });

  describe("refresh", () => {
    it("throws when not configured", async () => {
      mockAdapter.configured = false;
      await expect(service.refresh()).rejects.toThrow("not configured");
    });
  });
});
