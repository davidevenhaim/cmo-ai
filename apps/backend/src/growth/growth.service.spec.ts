/**
 * growth.service.spec.ts
 * M6.6 Growth Verification Gate — deterministic safety rules for all growth services.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";

import { ContactService } from "./contact.service";
import { SegmentService } from "./segment.service";
import { AbandonedCheckoutService } from "./abandoned-checkout.service";
import { FrequencyCapService } from "./frequency-cap.service";
import { ReplenishmentService } from "./replenishment.service";
import { UpsellService } from "./upsell.service";
import { CampaignService } from "./campaign.service";
import { EmailProviderService } from "./email-provider.service";
import { GrowthContextService } from "./growth-context.service";
import { GrowthSyncService } from "./growth-sync.service";

import { PrismaService } from "../prisma.service";
import { ApprovalService } from "../approval/approval.service";
import { ShopifyGraphqlAdapter } from "../shopify/shopify-graphql.adapter";

// ---------------------------------------------------------------------------
// Shared constants (mirrored from service source — any mismatch is a test fail)
// ---------------------------------------------------------------------------
const BRAND_ID = "luminesce-brand-001";
const VIP_MIN_ORDERS = 5;
const VIP_MIN_LTV = 500;
const LAPSED_DAYS = 180;
const RECENT_DAYS = 30;
const HIGH_VALUE_ABANDONMENT_THRESHOLD = 150;
const MIN_SAMPLE_SIZE = 10;
const DEFAULT_EXPIRY_DAYS = 30;

// ---------------------------------------------------------------------------
// Shared Prisma mock — reset between every test via jest.clearAllMocks()
// ---------------------------------------------------------------------------
const mockPrisma = {
  contact: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  contactSuppression: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  abandonedCheckout: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
    findFirst: jest.fn(),
  },
  segment: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  campaign: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
  },
  campaignTouch: {
    create: jest.fn(),
    count: jest.fn(),
  },
  frequencyCapRule: {
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  productRecommendation: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
  replenishmentConfig: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
  emailMessage: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  approval: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  conversionAttribution: {
    create: jest.fn(),
  },
  growthSyncRun: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

// ---------------------------------------------------------------------------
// SECTION 1: ContactService — marketing consent
// ---------------------------------------------------------------------------

describe("ContactService — marketing consent", () => {
  let service: ContactService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ContactService);
  });

  it("SUBSCRIBED + no suppressions → true", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-1",
      emailMarketingStatus: "SUBSCRIBED",
    });
    mockPrisma.contactSuppression.findMany.mockResolvedValue([]);

    const result = await service.isMarketingEligible("c-1");

    expect(result).toBe(true);
    expect(mockPrisma.contact.findUnique).toHaveBeenCalledWith({
      where: { id: "c-1" },
    });
    expect(mockPrisma.contactSuppression.findMany).toHaveBeenCalledTimes(1);
  });

  it("UNSUBSCRIBED → false (suppressions never checked)", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-2",
      emailMarketingStatus: "UNSUBSCRIBED",
    });

    const result = await service.isMarketingEligible("c-2");

    expect(result).toBe(false);
    expect(mockPrisma.contactSuppression.findMany).not.toHaveBeenCalled();
  });

  it("NOT_SUBSCRIBED → false (suppressions never checked)", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-3",
      emailMarketingStatus: "NOT_SUBSCRIBED",
    });

    const result = await service.isMarketingEligible("c-3");

    expect(result).toBe(false);
    expect(mockPrisma.contactSuppression.findMany).not.toHaveBeenCalled();
  });

  it("PENDING → false (suppressions never checked)", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-4",
      emailMarketingStatus: "PENDING",
    });

    const result = await service.isMarketingEligible("c-4");

    expect(result).toBe(false);
    expect(mockPrisma.contactSuppression.findMany).not.toHaveBeenCalled();
  });

  it("contact not found → false", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(null);

    const result = await service.isMarketingEligible("ghost");

    expect(result).toBe(false);
    expect(mockPrisma.contactSuppression.findMany).not.toHaveBeenCalled();
  });

  it("SUBSCRIBED + permanent suppression (expiresAt: null) → false", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-5",
      emailMarketingStatus: "SUBSCRIBED",
    });
    mockPrisma.contactSuppression.findMany.mockResolvedValue([
      { id: "sup-1", contactId: "c-5", reason: "COMPLAINT", expiresAt: null },
    ]);

    const result = await service.isMarketingEligible("c-5");

    expect(result).toBe(false);
  });

  it("SUBSCRIBED + expired suppression (findMany returns []) → true", async () => {
    // The service queries with OR: [expiresAt null, expiresAt > now].
    // An expired suppression would NOT be returned — so we mock empty array.
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-6",
      emailMarketingStatus: "SUBSCRIBED",
    });
    mockPrisma.contactSuppression.findMany.mockResolvedValue([]);

    const result = await service.isMarketingEligible("c-6");

    expect(result).toBe(true);
  });

  it("SUBSCRIBED + future suppression → false", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-7",
      emailMarketingStatus: "SUBSCRIBED",
    });
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockPrisma.contactSuppression.findMany.mockResolvedValue([
      {
        id: "sup-2",
        contactId: "c-7",
        reason: "TEMP_HOLD",
        expiresAt: futureDate,
      },
    ]);

    const result = await service.isMarketingEligible("c-7");

    expect(result).toBe(false);
  });

  it("getActiveSuppressions uses correct OR clause (expiresAt null OR expiresAt > now)", async () => {
    mockPrisma.contactSuppression.findMany.mockResolvedValue([]);
    await service.getActiveSuppressions("c-99");

    expect(mockPrisma.contactSuppression.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactId: "c-99",
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
  });

  it("REDACTED status → false", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({
      id: "c-8",
      emailMarketingStatus: "REDACTED",
    });

    const result = await service.isMarketingEligible("c-8");

    expect(result).toBe(false);
    expect(mockPrisma.contactSuppression.findMany).not.toHaveBeenCalled();
  });

  it("addSuppression passes correct data to prisma", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mockPrisma.contactSuppression.create.mockResolvedValue({ id: "sup-10" });

    await service.addSuppression(
      "c-10",
      "SPAM_COMPLAINT",
      "detail text",
      expiresAt,
    );

    expect(mockPrisma.contactSuppression.create).toHaveBeenCalledWith({
      data: {
        contactId: "c-10",
        reason: "SPAM_COMPLAINT",
        detail: "detail text",
        expiresAt,
      },
    });
  });

  it("addSuppression without expiresAt sets expiresAt: null", async () => {
    mockPrisma.contactSuppression.create.mockResolvedValue({ id: "sup-11" });

    await service.addSuppression("c-11", "BOUNCE");

    expect(mockPrisma.contactSuppression.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expiresAt: null }),
    });
  });
});

// ---------------------------------------------------------------------------
// SECTION 2: SegmentService — segment types
// ---------------------------------------------------------------------------

describe("SegmentService — segment types", () => {
  let service: SegmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SegmentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SegmentService);
    // Default: findMany returns [], count returns 0, upsert returns {}
    mockPrisma.contact.findMany.mockResolvedValue([]);
    mockPrisma.contact.count.mockResolvedValue(0);
    mockPrisma.segment.upsert.mockResolvedValue({});
  });

  it("PROSPECT → where includes orderCount: 0 and SUBSCRIBED", async () => {
    await service.getMembersForSegment("PROSPECT");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          orderCount: 0,
          emailMarketingStatus: "SUBSCRIBED",
        }),
      }),
    );
  });

  it("FIRST_TIME_CUSTOMER → where includes orderCount: 1 and SUBSCRIBED", async () => {
    await service.getMembersForSegment("FIRST_TIME_CUSTOMER");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          orderCount: 1,
          emailMarketingStatus: "SUBSCRIBED",
        }),
      }),
    );
  });

  it("REPEAT_CUSTOMER → where includes orderCount: { gte: 2 } and SUBSCRIBED", async () => {
    await service.getMembersForSegment("REPEAT_CUSTOMER");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          orderCount: { gte: 2 },
          emailMarketingStatus: "SUBSCRIBED",
        }),
      }),
    );
  });

  it("VIP → where includes orderCount: { gte: 5 }, lifetimeRevenue: { gte: 500 } and SUBSCRIBED", async () => {
    await service.getMembersForSegment("VIP");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          orderCount: { gte: VIP_MIN_ORDERS },
          lifetimeRevenue: { gte: VIP_MIN_LTV },
          emailMarketingStatus: "SUBSCRIBED",
        }),
      }),
    );
  });

  it("RECENT_CUSTOMER → where includes lastOrderAt: { gte: Date } and SUBSCRIBED", async () => {
    await service.getMembersForSegment("RECENT_CUSTOMER");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          lastOrderAt: { gte: expect.any(Date) },
          emailMarketingStatus: "SUBSCRIBED",
        }),
      }),
    );
  });

  it("RECENT_CUSTOMER cutoff is approximately RECENT_DAYS ago", async () => {
    const before = Date.now();
    await service.getMembersForSegment("RECENT_CUSTOMER");
    const after = Date.now();

    const call = mockPrisma.contact.findMany.mock.calls[0][0];
    const cutoff: Date = call.where.lastOrderAt.gte;
    const expectedLow = new Date(
      before - RECENT_DAYS * 24 * 60 * 60 * 1000 - 1000,
    );
    const expectedHigh = new Date(
      after - RECENT_DAYS * 24 * 60 * 60 * 1000 + 1000,
    );

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedLow.getTime());
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedHigh.getTime());
  });

  it("LAPSED_CUSTOMER → where includes orderCount: { gte: 1 }, lastOrderAt: { lt: Date } and SUBSCRIBED", async () => {
    await service.getMembersForSegment("LAPSED_CUSTOMER");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          orderCount: { gte: 1 },
          lastOrderAt: { lt: expect.any(Date) },
          emailMarketingStatus: "SUBSCRIBED",
        }),
      }),
    );
  });

  it("LAPSED_CUSTOMER cutoff is approximately LAPSED_DAYS ago", async () => {
    const before = Date.now();
    await service.getMembersForSegment("LAPSED_CUSTOMER");
    const after = Date.now();

    const call = mockPrisma.contact.findMany.mock.calls[0][0];
    const cutoff: Date = call.where.lastOrderAt.lt;
    const expectedLow = new Date(
      before - LAPSED_DAYS * 24 * 60 * 60 * 1000 - 1000,
    );
    const expectedHigh = new Date(
      after - LAPSED_DAYS * 24 * 60 * 60 * 1000 + 1000,
    );

    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedLow.getTime());
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedHigh.getTime());
  });

  it("ABANDONED_CHECKOUT → where includes abandonedCheckouts.some.status: ACTIVE and SUBSCRIBED", async () => {
    await service.getMembersForSegment("ABANDONED_CHECKOUT");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          emailMarketingStatus: "SUBSCRIBED",
          abandonedCheckouts: { some: { status: "ACTIVE" } },
        }),
      }),
    );
  });

  it("HIGH_VALUE_ABANDONMENT → where includes totalValue: { gte: 150 }", async () => {
    await service.getMembersForSegment("HIGH_VALUE_ABANDONMENT");

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          emailMarketingStatus: "SUBSCRIBED",
          abandonedCheckouts: {
            some: {
              status: "ACTIVE",
              totalValue: { gte: HIGH_VALUE_ABANDONMENT_THRESHOLD },
            },
          },
        }),
      }),
    );
  });

  it("unknown type → returns [] without calling findMany", async () => {
    const result = await service.getMembersForSegment("UNKNOWN_SEGMENT");

    expect(result).toEqual([]);
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });

  describe("refreshAll", () => {
    it("calls count + upsert for each of 8 segments", async () => {
      mockPrisma.contact.count.mockResolvedValue(5);
      mockPrisma.segment.upsert.mockResolvedValue({});

      await service.refreshAll();

      // 8 segments → 8 count calls, 8 upsert calls
      expect(mockPrisma.contact.count).toHaveBeenCalledTimes(8);
      expect(mockPrisma.segment.upsert).toHaveBeenCalledTimes(8);
    });

    it("returns object with all 8 segment keys", async () => {
      mockPrisma.contact.count.mockResolvedValue(3);
      mockPrisma.segment.upsert.mockResolvedValue({});

      const result = await service.refreshAll();

      expect(result).toHaveProperty("PROSPECT");
      expect(result).toHaveProperty("FIRST_TIME_CUSTOMER");
      expect(result).toHaveProperty("REPEAT_CUSTOMER");
      expect(result).toHaveProperty("VIP");
      expect(result).toHaveProperty("RECENT_CUSTOMER");
      expect(result).toHaveProperty("LAPSED_CUSTOMER");
      expect(result).toHaveProperty("ABANDONED_CHECKOUT");
      expect(result).toHaveProperty("HIGH_VALUE_ABANDONMENT");
    });

    it("segment count values match what prisma.contact.count returns", async () => {
      mockPrisma.contact.count.mockResolvedValue(42);
      mockPrisma.segment.upsert.mockResolvedValue({});

      const result = await service.refreshAll();

      for (const key of Object.keys(result)) {
        expect(result[key]).toBe(42);
      }
    });

    it("upsert is called with brandId_type_name composite key", async () => {
      mockPrisma.contact.count.mockResolvedValue(0);
      mockPrisma.segment.upsert.mockResolvedValue({});

      await service.refreshAll();

      const firstCall = mockPrisma.segment.upsert.mock.calls[0][0];
      expect(firstCall.where).toHaveProperty("brandId_type_name");
      expect(firstCall.where.brandId_type_name).toMatchObject({
        brandId: BRAND_ID,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// SECTION 3: AbandonedCheckoutService
// ---------------------------------------------------------------------------

const mockShopify = {
  fetchAbandonedCheckouts: jest.fn(),
  fetchOrders: jest.fn(),
  configured: true,
};

const mockContactService = {
  findByEmail: jest.fn(),
  findByShopifyId: jest.fn(),
  upsert: jest.fn(),
};

function makeRawCheckout(overrides: Record<string, any> = {}) {
  return {
    id: "gid://shopify/AbandonedCheckout/1",
    token: "abc123",
    abandonedCheckoutUrl: "https://store.myshopify.com/recover/abc123",
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    totalPriceSet: {
      shopMoney: { amount: "120.00", currencyCode: "USD" },
    },
    customer: {
      id: "gid://shopify/Customer/1",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
    },
    lineItems: {
      edges: [
        {
          node: {
            title: "Serum",
            quantity: 1,
            variant: {
              id: "var-1",
              sku: "SKU-1",
              product: { id: "gid://shopify/Product/1" },
            },
            originalTotalSet: {
              shopMoney: { amount: "120.00", currencyCode: "USD" },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("AbandonedCheckoutService", () => {
  let service: AbandonedCheckoutService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbandonedCheckoutService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyGraphqlAdapter, useValue: mockShopify },
        { provide: ContactService, useValue: mockContactService },
      ],
    }).compile();
    service = module.get(AbandonedCheckoutService);
  });

  // ingestFromShopify tests
  describe("ingestFromShopify", () => {
    it("calls shopify.fetchAbandonedCheckouts and upserts each checkout", async () => {
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [makeRawCheckout()],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      const result = await service.ingestFromShopify();

      expect(mockShopify.fetchAbandonedCheckouts).toHaveBeenCalledTimes(1);
      expect(mockPrisma.abandonedCheckout.upsert).toHaveBeenCalledTimes(1);
      expect(result.upserted).toBe(1);
    });

    it("links contactId when findByEmail returns a contact", async () => {
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [makeRawCheckout()],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue({
        id: "contact-99",
        email: "test@example.com",
      });
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      const result = await service.ingestFromShopify();

      expect(result.linked).toBe(1);
      const upsertCall = mockPrisma.abandonedCheckout.upsert.mock.calls[0][0];
      expect(upsertCall.create.contactId).toBe("contact-99");
    });

    it("anonymous checkout (customer: null) → email: null, contactId: null", async () => {
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [makeRawCheckout({ customer: null })],
        truncated: false,
      });
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      const result = await service.ingestFromShopify();

      expect(result.linked).toBe(0);
      const upsertCall = mockPrisma.abandonedCheckout.upsert.mock.calls[0][0];
      expect(upsertCall.create.email).toBeNull();
      expect(upsertCall.create.contactId).toBeNull();
    });

    it("dedup: same shopify id → upsert called once (Shopify returns 1 item)", async () => {
      const checkout = makeRawCheckout();
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [checkout],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      await service.ingestFromShopify();

      expect(mockPrisma.abandonedCheckout.upsert).toHaveBeenCalledTimes(1);
    });

    it("normalizes totalValue from string '120.00' → number 120", async () => {
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [makeRawCheckout()],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      await service.ingestFromShopify();

      const upsertCall = mockPrisma.abandonedCheckout.upsert.mock.calls[0][0];
      expect(upsertCall.create.totalValue).toBe(120);
      expect(typeof upsertCall.create.totalValue).toBe("number");
    });

    it("upsert where clause uses shopifyCheckoutId", async () => {
      const checkout = makeRawCheckout({
        id: "gid://shopify/AbandonedCheckout/XYZ",
      });
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [checkout],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      await service.ingestFromShopify();

      const upsertCall = mockPrisma.abandonedCheckout.upsert.mock.calls[0][0];
      expect(upsertCall.where).toEqual({
        shopifyCheckoutId: "gid://shopify/AbandonedCheckout/XYZ",
      });
    });

    it("create record includes status: ACTIVE", async () => {
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [makeRawCheckout()],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      await service.ingestFromShopify();

      const upsertCall = mockPrisma.abandonedCheckout.upsert.mock.calls[0][0];
      expect(upsertCall.create.status).toBe("ACTIVE");
    });

    it("multiple checkouts → upsert called for each", async () => {
      const c1 = makeRawCheckout({ id: "gid://shopify/AbandonedCheckout/1" });
      const c2 = makeRawCheckout({ id: "gid://shopify/AbandonedCheckout/2" });
      const c3 = makeRawCheckout({ id: "gid://shopify/AbandonedCheckout/3" });
      mockShopify.fetchAbandonedCheckouts.mockResolvedValue({
        items: [c1, c2, c3],
        truncated: false,
      });
      mockContactService.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});

      const result = await service.ingestFromShopify();

      expect(result.upserted).toBe(3);
      expect(mockPrisma.abandonedCheckout.upsert).toHaveBeenCalledTimes(3);
    });
  });

  // reconcileWithOrders tests
  describe("reconcileWithOrders", () => {
    it("checkout with matching checkoutToken → $transaction called (RECOVERED)", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([
        {
          id: "co-1",
          shopifyCheckoutId: "checkout-1",
          checkoutToken: "tok-abc",
          status: "ACTIVE",
          contactId: "contact-1",
          totalValue: 120,
          currencyCode: "USD",
        },
      ]);
      mockPrisma.$transaction.mockResolvedValue([]);
      // Mock internal prisma calls used in transaction array
      mockPrisma.abandonedCheckout.update.mockResolvedValue({});
      mockPrisma.conversionAttribution.create.mockResolvedValue({});

      const orders = [
        {
          id: "gid://shopify/Order/1",
          checkoutToken: "tok-abc",
          createdAt: new Date().toISOString(),
          cancelledAt: null,
          test: false,
          financialStatus: "paid",
          totalPriceSet: {
            shopMoney: { amount: "120.00", currencyCode: "USD" },
          },
          totalRefundedSet: { shopMoney: { amount: "0.00" } },
          email: "test@example.com",
          customer: null,
          lineItems: { edges: [] },
        },
      ];

      const count = await service.reconcileWithOrders(orders);

      expect(count).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("RECOVERY_STARTED checkout also matched via token", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([
        {
          id: "co-2",
          shopifyCheckoutId: "checkout-2",
          checkoutToken: "tok-xyz",
          status: "RECOVERY_STARTED",
          contactId: null,
          totalValue: 80,
          currencyCode: "USD",
        },
      ]);
      mockPrisma.$transaction.mockResolvedValue([]);
      mockPrisma.abandonedCheckout.update.mockResolvedValue({});
      mockPrisma.conversionAttribution.create.mockResolvedValue({});

      const orders = [
        {
          id: "gid://shopify/Order/2",
          checkoutToken: "tok-xyz",
          createdAt: new Date().toISOString(),
          cancelledAt: null,
          test: false,
          financialStatus: "paid",
          totalPriceSet: {
            shopMoney: { amount: "80.00", currencyCode: "USD" },
          },
          totalRefundedSet: { shopMoney: { amount: "0.00" } },
          email: null,
          customer: null,
          lineItems: { edges: [] },
        },
      ];

      const count = await service.reconcileWithOrders(orders);

      expect(count).toBe(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("no matching token → $transaction not called", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([
        {
          id: "co-3",
          shopifyCheckoutId: "checkout-3",
          checkoutToken: "tok-nomatch",
          status: "ACTIVE",
          contactId: null,
          totalValue: 60,
          currencyCode: "USD",
        },
      ]);

      const orders = [
        {
          id: "gid://shopify/Order/3",
          checkoutToken: "tok-different",
          createdAt: new Date().toISOString(),
          cancelledAt: null,
          test: false,
          financialStatus: "paid",
          totalPriceSet: {
            shopMoney: { amount: "60.00", currencyCode: "USD" },
          },
          totalRefundedSet: { shopMoney: { amount: "0.00" } },
          email: null,
          customer: null,
          lineItems: { edges: [] },
        },
      ];

      const count = await service.reconcileWithOrders(orders);

      expect(count).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("null checkoutToken on order → checkout skipped", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([
        {
          id: "co-4",
          shopifyCheckoutId: "checkout-4",
          checkoutToken: "tok-something",
          status: "ACTIVE",
          contactId: null,
          totalValue: 45,
          currencyCode: "USD",
        },
      ]);

      const orders = [
        {
          id: "gid://shopify/Order/4",
          checkoutToken: null,
          createdAt: new Date().toISOString(),
          cancelledAt: null,
          test: false,
          financialStatus: "paid",
          totalPriceSet: {
            shopMoney: { amount: "45.00", currencyCode: "USD" },
          },
          totalRefundedSet: { shopMoney: { amount: "0.00" } },
          email: null,
          customer: null,
          lineItems: { edges: [] },
        },
      ];

      const count = await service.reconcileWithOrders(orders);

      expect(count).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("empty orders array → returns 0 immediately", async () => {
      const count = await service.reconcileWithOrders([]);

      expect(count).toBe(0);
      expect(mockPrisma.abandonedCheckout.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("transaction called once per recovered checkout (2 checkouts → 2 transactions)", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([
        {
          id: "co-A",
          shopifyCheckoutId: "chk-A",
          checkoutToken: "tok-A",
          status: "ACTIVE",
          contactId: null,
          totalValue: 100,
          currencyCode: "USD",
        },
        {
          id: "co-B",
          shopifyCheckoutId: "chk-B",
          checkoutToken: "tok-B",
          status: "ACTIVE",
          contactId: null,
          totalValue: 200,
          currencyCode: "USD",
        },
      ]);
      mockPrisma.$transaction.mockResolvedValue([]);

      const orders = [
        {
          id: "gid://shopify/Order/A",
          checkoutToken: "tok-A",
          createdAt: new Date().toISOString(),
          cancelledAt: null,
          test: false,
          financialStatus: "paid",
          totalPriceSet: {
            shopMoney: { amount: "100.00", currencyCode: "USD" },
          },
          totalRefundedSet: { shopMoney: { amount: "0.00" } },
          email: null,
          customer: null,
          lineItems: { edges: [] },
        },
        {
          id: "gid://shopify/Order/B",
          checkoutToken: "tok-B",
          createdAt: new Date().toISOString(),
          cancelledAt: null,
          test: false,
          financialStatus: "paid",
          totalPriceSet: {
            shopMoney: { amount: "200.00", currencyCode: "USD" },
          },
          totalRefundedSet: { shopMoney: { amount: "0.00" } },
          email: null,
          customer: null,
          lineItems: { edges: [] },
        },
      ];

      const count = await service.reconcileWithOrders(orders);

      expect(count).toBe(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  // expireOld tests
  describe("expireOld", () => {
    it("calls abandonedCheckout.updateMany with correct status filter", async () => {
      mockPrisma.abandonedCheckout.updateMany.mockResolvedValue({ count: 5 });

      await service.expireOld();

      expect(mockPrisma.abandonedCheckout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            brandId: BRAND_ID,
            status: { in: ["ACTIVE", "RECOVERY_STARTED"] },
            abandonedAt: { lt: expect.any(Date) },
          }),
          data: { status: "EXPIRED" },
        }),
      );
    });

    it("returns count from updateMany result", async () => {
      mockPrisma.abandonedCheckout.updateMany.mockResolvedValue({ count: 7 });

      const result = await service.expireOld();

      expect(result).toBe(7);
    });

    it("cutoff is approximately DEFAULT_EXPIRY_DAYS ago", async () => {
      mockPrisma.abandonedCheckout.updateMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      await service.expireOld(DEFAULT_EXPIRY_DAYS);

      const after = Date.now();
      const call = mockPrisma.abandonedCheckout.updateMany.mock.calls[0][0];
      const cutoff: Date = call.where.abandonedAt.lt;
      const expectedLow = new Date(
        before - DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000 - 1000,
      );
      const expectedHigh = new Date(
        after - DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000 + 1000,
      );

      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedLow.getTime());
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedHigh.getTime());
    });

    it("custom olderThanDays parameter is respected", async () => {
      mockPrisma.abandonedCheckout.updateMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      await service.expireOld(60);

      const after = Date.now();
      const call = mockPrisma.abandonedCheckout.updateMany.mock.calls[0][0];
      const cutoff: Date = call.where.abandonedAt.lt;
      const expectedLow = new Date(before - 60 * 24 * 60 * 60 * 1000 - 1000);
      const expectedHigh = new Date(after - 60 * 24 * 60 * 60 * 1000 + 1000);

      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedLow.getTime());
      expect(cutoff.getTime()).toBeLessThanOrEqual(expectedHigh.getTime());
    });
  });

  // getHighValue tests
  describe("getHighValue", () => {
    it("calls findMany with status: ACTIVE and totalValue: { gte: 150 }", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([]);

      await service.getHighValue();

      expect(mockPrisma.abandonedCheckout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            brandId: BRAND_ID,
            status: "ACTIVE",
            totalValue: { gte: HIGH_VALUE_ABANDONMENT_THRESHOLD },
          }),
        }),
      );
    });

    it("custom threshold parameter respected", async () => {
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue([]);

      await service.getHighValue(200);

      const call = mockPrisma.abandonedCheckout.findMany.mock.calls[0][0];
      expect(call.where.totalValue).toEqual({ gte: 200 });
    });

    it("returns the results from findMany", async () => {
      const fakeData = [{ id: "co-1", totalValue: 300 }];
      mockPrisma.abandonedCheckout.findMany.mockResolvedValue(fakeData);

      const result = await service.getHighValue();

      expect(result).toEqual(fakeData);
    });
  });
});

// ---------------------------------------------------------------------------
// SECTION 4: FrequencyCapService
// ---------------------------------------------------------------------------

describe("FrequencyCapService", () => {
  let service: FrequencyCapService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FrequencyCapService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(FrequencyCapService);
  });

  it("no rules → eligible (findMany returns [])", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([]);

    const result = await service.isEligible("c-1");

    expect(result).toBe(true);
    expect(mockPrisma.campaignTouch.count).not.toHaveBeenCalled();
  });

  it("rule with maxMessages=3, touches=2 → eligible", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-1", maxMessages: 3, windowDays: 7, flowType: null },
    ]);
    mockPrisma.campaignTouch.count.mockResolvedValue(2);

    const result = await service.isEligible("c-1");

    expect(result).toBe(true);
  });

  it("rule with maxMessages=3, touches=3 → NOT eligible (cap at equals)", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-2", maxMessages: 3, windowDays: 7, flowType: null },
    ]);
    mockPrisma.campaignTouch.count.mockResolvedValue(3);

    const result = await service.isEligible("c-1");

    expect(result).toBe(false);
  });

  it("rule with maxMessages=3, touches=4 → NOT eligible (cap exceeded)", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-3", maxMessages: 3, windowDays: 7, flowType: null },
    ]);
    mockPrisma.campaignTouch.count.mockResolvedValue(4);

    const result = await service.isEligible("c-1");

    expect(result).toBe(false);
  });

  it("global rule (flowType: null) applies regardless of flowType arg", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-4", maxMessages: 2, windowDays: 14, flowType: null },
    ]);
    mockPrisma.campaignTouch.count.mockResolvedValue(2);

    const result = await service.isEligible("c-1", "NEWSLETTER");

    expect(result).toBe(false);
  });

  it("flowType-specific rule: OR clause includes null and the specific type", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([]);

    await service.isEligible("c-1", "ABANDONED_CHECKOUT");

    expect(mockPrisma.frequencyCapRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          OR: expect.arrayContaining([
            { flowType: null },
            { flowType: "ABANDONED_CHECKOUT" },
          ]),
        }),
      }),
    );
  });

  it("no flowType arg → OR clause only contains null", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([]);

    await service.isEligible("c-1");

    const call = mockPrisma.frequencyCapRule.findMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([{ flowType: null }]);
  });

  it("multiple rules: both must pass — fails on first cap breach", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-global", maxMessages: 5, windowDays: 30, flowType: null },
      {
        id: "r-specific",
        maxMessages: 2,
        windowDays: 7,
        flowType: "REACTIVATION",
      },
    ]);
    // First rule: 4 touches (under 5 → pass)
    // Second rule: 3 touches (over 2 → fail)
    mockPrisma.campaignTouch.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3);

    const result = await service.isEligible("c-1", "REACTIVATION");

    expect(result).toBe(false);
  });

  it("multiple rules: all pass → eligible", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-A", maxMessages: 5, windowDays: 30, flowType: null },
      { id: "r-B", maxMessages: 2, windowDays: 7, flowType: "VIP_OFFER" },
    ]);
    mockPrisma.campaignTouch.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const result = await service.isEligible("c-1", "VIP_OFFER");

    expect(result).toBe(true);
  });

  it("campaignTouch.count is called with touchType: SEND and timestamp window", async () => {
    mockPrisma.frequencyCapRule.findMany.mockResolvedValue([
      { id: "r-5", maxMessages: 3, windowDays: 7, flowType: null },
    ]);
    mockPrisma.campaignTouch.count.mockResolvedValue(0);

    await service.isEligible("c-1");

    expect(mockPrisma.campaignTouch.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contactId: "c-1",
          touchType: "SEND",
          timestamp: { gte: expect.any(Date) },
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// SECTION 5: ReplenishmentService
// ---------------------------------------------------------------------------

describe("ReplenishmentService", () => {
  let service: ReplenishmentService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplenishmentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ReplenishmentService);
  });

  it("getCandidates: calls replenishmentConfig.findMany with include: { product: true }", async () => {
    mockPrisma.replenishmentConfig.findMany.mockResolvedValue([]);

    await service.getCandidates();

    expect(mockPrisma.replenishmentConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { brandId: BRAND_ID },
        include: { product: true },
      }),
    );
  });

  it("getCandidates: no configs → returns empty array (contact.findMany not called)", async () => {
    mockPrisma.replenishmentConfig.findMany.mockResolvedValue([]);

    const result = await service.getCandidates();

    expect(result).toEqual([]);
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("getCandidates: contact.findMany called with lastOrderAt range and SUBSCRIBED filter", async () => {
    mockPrisma.replenishmentConfig.findMany.mockResolvedValue([
      {
        id: "rc-1",
        productId: "p-1",
        windowDays: 30,
        notes: null,
        product: { name: "Night Balm" },
        brandId: BRAND_ID,
      },
    ]);
    mockPrisma.contact.findMany.mockResolvedValue([]);

    await service.getCandidates();

    expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          brandId: BRAND_ID,
          emailMarketingStatus: "SUBSCRIBED",
          orderCount: { gte: 1 },
          lastOrderAt: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
      }),
    );
  });

  it("getCandidates: returns structured result with productName and windowDays", async () => {
    mockPrisma.replenishmentConfig.findMany.mockResolvedValue([
      {
        id: "rc-2",
        productId: "p-2",
        windowDays: 45,
        notes: null,
        product: { name: "Vitamin C Serum" },
        brandId: BRAND_ID,
      },
    ]);
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: "c-1", email: "a@b.com", firstName: "Alice" },
    ]);

    const result = await service.getCandidates();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      productId: "p-2",
      productName: "Vitamin C Serum",
      windowDays: 45,
    });
    expect(result[0].contacts).toHaveLength(1);
  });

  it("getCandidates: lastOrderAt gte < lte (gte is earlier date)", async () => {
    mockPrisma.replenishmentConfig.findMany.mockResolvedValue([
      {
        id: "rc-3",
        productId: "p-3",
        windowDays: 30,
        notes: null,
        product: { name: "Balm" },
        brandId: BRAND_ID,
      },
    ]);
    mockPrisma.contact.findMany.mockResolvedValue([]);

    await service.getCandidates();

    const call = mockPrisma.contact.findMany.mock.calls[0][0];
    const gte: Date = call.where.lastOrderAt.gte;
    const lte: Date = call.where.lastOrderAt.lte;

    expect(gte.getTime()).toBeLessThan(lte.getTime());
  });

  it("multiple configs → contact.findMany called once per config", async () => {
    mockPrisma.replenishmentConfig.findMany.mockResolvedValue([
      {
        id: "rc-4",
        productId: "p-4",
        windowDays: 30,
        notes: null,
        product: { name: "A" },
        brandId: BRAND_ID,
      },
      {
        id: "rc-5",
        productId: "p-5",
        windowDays: 60,
        notes: null,
        product: { name: "B" },
        brandId: BRAND_ID,
      },
    ]);
    mockPrisma.contact.findMany.mockResolvedValue([]);

    const result = await service.getCandidates();

    expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SECTION 6: UpsellService — co-occurrence and sample size
// ---------------------------------------------------------------------------

describe("UpsellService — co-occurrence and sample size", () => {
  let service: UpsellService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpsellService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UpsellService);
  });

  function makeOrder(productIds: string[]): any {
    return {
      id: `gid://shopify/Order/${Math.random()}`,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      test: false,
      financialStatus: "paid",
      totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
      totalRefundedSet: { shopMoney: { amount: "0.00" } },
      email: null,
      checkoutToken: null,
      customer: null,
      lineItems: {
        edges: productIds.map((pid) => ({
          node: {
            product: { id: pid },
            title: "Product",
            quantity: 1,
            originalUnitPriceSet: {
              shopMoney: { amount: "50.00" },
            },
          },
        })),
      },
    };
  }

  it("10 orders each with A+B → upsert called for A→B and B→A pairs", async () => {
    const orders = Array.from({ length: 10 }, () =>
      makeOrder(["gid://shopify/Product/A", "gid://shopify/Product/B"]),
    );

    mockPrisma.product.findMany.mockResolvedValue([
      { id: "internal-A", shopifyProductId: "gid://shopify/Product/A" },
      { id: "internal-B", shopifyProductId: "gid://shopify/Product/B" },
    ]);
    mockPrisma.productRecommendation.upsert.mockResolvedValue({});

    const result = await service.syncCommerceRecommendations(orders, 10);

    expect(result.upserted).toBe(2); // A→B and B→A
    expect(mockPrisma.productRecommendation.upsert).toHaveBeenCalledTimes(2);
  });

  it("10 orders → sampleSize: 10 in upsert data", async () => {
    const orders = Array.from({ length: 10 }, () =>
      makeOrder(["gid://shopify/Product/A", "gid://shopify/Product/B"]),
    );

    mockPrisma.product.findMany.mockResolvedValue([
      { id: "internal-A", shopifyProductId: "gid://shopify/Product/A" },
      { id: "internal-B", shopifyProductId: "gid://shopify/Product/B" },
    ]);
    mockPrisma.productRecommendation.upsert.mockResolvedValue({});

    await service.syncCommerceRecommendations(orders, 10);

    const calls = mockPrisma.productRecommendation.upsert.mock.calls;
    for (const [call] of calls) {
      expect(call.create.sampleSize).toBe(10);
      expect(call.update.sampleSize).toBe(10);
    }
  });

  it("9 orders (below minSampleSize=10) → upsert NOT called", async () => {
    const orders = Array.from({ length: 9 }, () =>
      makeOrder(["gid://shopify/Product/A", "gid://shopify/Product/B"]),
    );

    mockPrisma.product.findMany.mockResolvedValue([
      { id: "internal-A", shopifyProductId: "gid://shopify/Product/A" },
      { id: "internal-B", shopifyProductId: "gid://shopify/Product/B" },
    ]);

    const result = await service.syncCommerceRecommendations(orders, 10);

    expect(result.upserted).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(mockPrisma.productRecommendation.upsert).not.toHaveBeenCalled();
  });

  it("same product in both positions → NOT upserted (srcId === tgtId)", async () => {
    // Order with duplicate product ids
    const orders = Array.from({ length: 15 }, () =>
      makeOrder([
        "gid://shopify/Product/A",
        "gid://shopify/Product/A",
        "gid://shopify/Product/B",
      ]),
    );

    // Both A and B resolve to the same internal id — so A→B is fine, but A→A must not happen
    mockPrisma.product.findMany.mockResolvedValue([
      { id: "internal-A", shopifyProductId: "gid://shopify/Product/A" },
      { id: "internal-B", shopifyProductId: "gid://shopify/Product/B" },
    ]);
    mockPrisma.productRecommendation.upsert.mockResolvedValue({});

    await service.syncCommerceRecommendations(orders, 10);

    const calls = mockPrisma.productRecommendation.upsert.mock.calls;
    for (const [call] of calls) {
      expect(call.create.sourceProductId).not.toBe(call.create.targetProductId);
    }
  });

  it("same shopify product id maps to the same internal id → self-pair skipped", async () => {
    // If A and B have the same internal ID (shouldn't happen normally, but let's guard)
    const orders = Array.from({ length: 15 }, () =>
      makeOrder(["gid://shopify/Product/A", "gid://shopify/Product/B"]),
    );

    // Both resolve to same internal id
    mockPrisma.product.findMany.mockResolvedValue([
      { id: "same-internal", shopifyProductId: "gid://shopify/Product/A" },
      { id: "same-internal", shopifyProductId: "gid://shopify/Product/B" },
    ]);
    mockPrisma.productRecommendation.upsert.mockResolvedValue({});

    const result = await service.syncCommerceRecommendations(orders, 10);

    expect(result.upserted).toBe(0);
    expect(mockPrisma.productRecommendation.upsert).not.toHaveBeenCalled();
  });

  it("strength = min(count / orders.length, 1.0)", async () => {
    const orders = Array.from({ length: 10 }, () =>
      makeOrder(["gid://shopify/Product/A", "gid://shopify/Product/B"]),
    );

    mockPrisma.product.findMany.mockResolvedValue([
      { id: "internal-A", shopifyProductId: "gid://shopify/Product/A" },
      { id: "internal-B", shopifyProductId: "gid://shopify/Product/B" },
    ]);
    mockPrisma.productRecommendation.upsert.mockResolvedValue({});

    await service.syncCommerceRecommendations(orders, 10);

    const calls = mockPrisma.productRecommendation.upsert.mock.calls;
    for (const [call] of calls) {
      expect(call.create.strength).toBe(Math.min(10 / 10, 1.0));
      expect(call.create.strength).toBeLessThanOrEqual(1.0);
    }
  });

  it("upsert uses COMMERCE source", async () => {
    const orders = Array.from({ length: 10 }, () =>
      makeOrder(["gid://shopify/Product/A", "gid://shopify/Product/B"]),
    );

    mockPrisma.product.findMany.mockResolvedValue([
      { id: "internal-A", shopifyProductId: "gid://shopify/Product/A" },
      { id: "internal-B", shopifyProductId: "gid://shopify/Product/B" },
    ]);
    mockPrisma.productRecommendation.upsert.mockResolvedValue({});

    await service.syncCommerceRecommendations(orders, 10);

    const calls = mockPrisma.productRecommendation.upsert.mock.calls;
    for (const [call] of calls) {
      expect(call.create.source).toBe("COMMERCE");
      expect(call.create.type).toBe("CROSS_SELL");
    }
  });

  describe("addManualRecommendation", () => {
    it("upserts with source: MANUAL", async () => {
      mockPrisma.productRecommendation.upsert.mockResolvedValue({
        id: "rec-1",
      });

      await service.addManualRecommendation({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        type: "CROSS_SELL",
      });

      expect(mockPrisma.productRecommendation.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            source: "MANUAL",
            sourceProductId: "p-src",
            targetProductId: "p-tgt",
            type: "CROSS_SELL",
            brandId: BRAND_ID,
          }),
        }),
      );
    });

    it("strength is not set in create (undefined/absent)", async () => {
      mockPrisma.productRecommendation.upsert.mockResolvedValue({
        id: "rec-2",
      });

      await service.addManualRecommendation({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        type: "UPSELL",
      });

      const call = mockPrisma.productRecommendation.upsert.mock.calls[0][0];
      expect(call.create.strength).toBeUndefined();
    });

    it("UPSELL type is persisted correctly", async () => {
      mockPrisma.productRecommendation.upsert.mockResolvedValue({
        id: "rec-3",
      });

      await service.addManualRecommendation({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        type: "UPSELL",
      });

      const call = mockPrisma.productRecommendation.upsert.mock.calls[0][0];
      expect(call.create.type).toBe("UPSELL");
    });

    it("notes passed through to create data", async () => {
      mockPrisma.productRecommendation.upsert.mockResolvedValue({
        id: "rec-4",
      });

      await service.addManualRecommendation({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        type: "CROSS_SELL",
        notes: "Good pairing",
      });

      const call = mockPrisma.productRecommendation.upsert.mock.calls[0][0];
      expect(call.create.notes).toBe("Good pairing");
    });

    it("uses composite unique key in where clause", async () => {
      mockPrisma.productRecommendation.upsert.mockResolvedValue({
        id: "rec-5",
      });

      await service.addManualRecommendation({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        type: "CROSS_SELL",
      });

      const call = mockPrisma.productRecommendation.upsert.mock.calls[0][0];
      expect(call.where).toHaveProperty(
        "brandId_sourceProductId_targetProductId_type",
      );
      expect(
        call.where.brandId_sourceProductId_targetProductId_type,
      ).toMatchObject({
        brandId: BRAND_ID,
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        type: "CROSS_SELL",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// SECTION 7: CampaignService — lifecycle + no auto-send
// ---------------------------------------------------------------------------

const mockApprovalService = {
  create: jest.fn(),
  resolve: jest.fn(),
};

const mockContactServiceForCampaign = {
  list: jest.fn(),
  isMarketingEligible: jest.fn(),
};

const mockSegmentService = {
  getMembersForSegment: jest.fn(),
  getSegmentSummary: jest.fn(),
};

const mockFrequencyCapService = {
  isEligible: jest.fn(),
};

const mockEmailProviderService = {
  send: jest.fn(),
};

describe("CampaignService — lifecycle + no auto-send", () => {
  let service: CampaignService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ApprovalService, useValue: mockApprovalService },
        { provide: ContactService, useValue: mockContactServiceForCampaign },
        { provide: SegmentService, useValue: mockSegmentService },
        { provide: FrequencyCapService, useValue: mockFrequencyCapService },
        { provide: EmailProviderService, useValue: mockEmailProviderService },
      ],
    }).compile();
    service = module.get(CampaignService);
  });

  describe("create", () => {
    it("creates campaign with status: DRAFT", async () => {
      mockPrisma.campaign.create.mockResolvedValue({
        id: "camp-1",
        status: "DRAFT",
      });

      await service.create({
        type: "NEWSLETTER",
        name: "Test Campaign",
      });

      expect(mockPrisma.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "DRAFT",
            brandId: BRAND_ID,
          }),
        }),
      );
    });

    it("creates campaign with all provided fields", async () => {
      mockPrisma.campaign.create.mockResolvedValue({ id: "camp-2" });

      await service.create({
        type: "REACTIVATION",
        name: "Win-Back",
        objective: "Re-engage lapsed users",
        segmentId: "seg-1",
        subject: "We miss you",
      });

      expect(mockPrisma.campaign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "REACTIVATION",
            name: "Win-Back",
            objective: "Re-engage lapsed users",
            segmentId: "seg-1",
            subject: "We miss you",
          }),
        }),
      );
    });
  });

  describe("submitForApproval", () => {
    it("calls approval.create with type: CAMPAIGN and updates status to PENDING_APPROVAL", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-1",
        name: "Test",
        type: "NEWSLETTER",
        objective: "Sell",
        status: "DRAFT",
      });
      mockApprovalService.create.mockResolvedValue({ id: "appr-1" });
      mockPrisma.campaign.update.mockResolvedValue({
        id: "camp-1",
        status: "PENDING_APPROVAL",
      });

      await service.submitForApproval("camp-1");

      expect(mockApprovalService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "CAMPAIGN" }),
      );
      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "camp-1" },
          data: { status: "PENDING_APPROVAL" },
        }),
      );
    });

    it("non-DRAFT campaign → throws Error", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-2",
        name: "Test",
        type: "NEWSLETTER",
        status: "PENDING_APPROVAL",
      });

      await expect(service.submitForApproval("camp-2")).rejects.toThrow();
      expect(mockApprovalService.create).not.toHaveBeenCalled();
    });

    it("APPROVED campaign → throws Error when submitted for approval", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-3",
        name: "Test",
        type: "NEWSLETTER",
        status: "APPROVED",
      });

      await expect(service.submitForApproval("camp-3")).rejects.toThrow();
    });
  });

  describe("approve", () => {
    it("resolves approval and updates campaign to APPROVED", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-1",
        name: "Test",
        type: "NEWSLETTER",
        status: "PENDING_APPROVAL",
      });
      mockPrisma.approval.findFirst.mockResolvedValue({
        id: "appr-1",
        status: "PENDING",
      });
      mockApprovalService.resolve.mockResolvedValue({ id: "appr-1" });
      mockPrisma.campaign.update.mockResolvedValue({
        id: "camp-1",
        status: "APPROVED",
      });

      await service.approve("camp-1", "admin-user");

      expect(mockApprovalService.resolve).toHaveBeenCalledWith(
        "appr-1",
        "APPROVED",
        "admin-user",
      );
      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "camp-1" },
          data: { status: "APPROVED" },
        }),
      );
    });

    it("non-PENDING_APPROVAL campaign → throws", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-2",
        name: "Test",
        type: "NEWSLETTER",
        status: "DRAFT",
      });

      await expect(service.approve("camp-2", "admin")).rejects.toThrow();
      expect(mockApprovalService.resolve).not.toHaveBeenCalled();
    });

    it("no pending approval found → still updates campaign status", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-3",
        name: "Test",
        type: "NEWSLETTER",
        status: "PENDING_APPROVAL",
      });
      mockPrisma.approval.findFirst.mockResolvedValue(null);
      mockPrisma.campaign.update.mockResolvedValue({
        id: "camp-3",
        status: "APPROVED",
      });

      await service.approve("camp-3", "admin");

      expect(mockApprovalService.resolve).not.toHaveBeenCalled();
      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "APPROVED" },
        }),
      );
    });
  });

  describe("queueEmails", () => {
    const content = {
      subject: "Hello",
      previewText: "Read me",
      body: "<p>Body</p>",
    };

    function setupApprovedCampaign(segmentId?: string) {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "c-1",
        status: "APPROVED",
        segmentId: segmentId ?? null,
        type: "NEWSLETTER",
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: "c-1",
        status: "SENT",
      });
      mockPrisma.campaignTouch.create.mockResolvedValue({});
    }

    it("returns { queued: 1, suppressed: 1 } — contact-1 sent, contact-2 (no email) suppressed", async () => {
      setupApprovedCampaign();
      mockContactServiceForCampaign.list.mockResolvedValue([
        { id: "contact-1", email: "a@b.com" },
        { id: "contact-2", email: null },
      ]);
      mockContactServiceForCampaign.isMarketingEligible.mockImplementation(
        (id: string) => Promise.resolve(id === "contact-1"),
      );
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProviderService.send.mockResolvedValue("msg-1");

      const result = await service.queueEmails("c-1", content);

      expect(result.queued).toBe(1);
      expect(result.suppressed).toBe(1);
      expect(mockEmailProviderService.send).toHaveBeenCalledTimes(1);
    });

    it("marketing-ineligible contact → suppressed, send NOT called", async () => {
      setupApprovedCampaign();
      mockContactServiceForCampaign.list.mockResolvedValue([
        { id: "contact-1", email: "a@b.com" },
      ]);
      mockContactServiceForCampaign.isMarketingEligible.mockResolvedValue(
        false,
      );

      const result = await service.queueEmails("c-1", content);

      expect(result.queued).toBe(0);
      expect(result.suppressed).toBe(1);
      expect(mockEmailProviderService.send).not.toHaveBeenCalled();
    });

    it("contact over frequency cap → suppressed, send NOT called", async () => {
      setupApprovedCampaign();
      mockContactServiceForCampaign.list.mockResolvedValue([
        { id: "contact-1", email: "a@b.com" },
      ]);
      mockContactServiceForCampaign.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(false);

      const result = await service.queueEmails("c-1", content);

      expect(result.queued).toBe(0);
      expect(result.suppressed).toBe(1);
      expect(mockEmailProviderService.send).not.toHaveBeenCalled();
    });

    it("non-APPROVED status → throws Error containing 'APPROVED'", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "c-1",
        status: "DRAFT",
        segmentId: null,
        type: "NEWSLETTER",
      });

      await expect(service.queueEmails("c-1", content)).rejects.toThrow(
        /APPROVED/,
      );
      expect(mockEmailProviderService.send).not.toHaveBeenCalled();
    });

    it("PENDING_APPROVAL status → throws Error", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "c-1",
        status: "PENDING_APPROVAL",
        segmentId: null,
        type: "NEWSLETTER",
      });

      await expect(service.queueEmails("c-1", content)).rejects.toThrow();
    });

    it("APPROVED does NOT auto-send — approve() alone does not call send", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-auto",
        name: "Test",
        type: "NEWSLETTER",
        status: "PENDING_APPROVAL",
      });
      mockPrisma.approval.findFirst.mockResolvedValue({
        id: "appr-2",
        status: "PENDING",
      });
      mockApprovalService.resolve.mockResolvedValue({ id: "appr-2" });
      mockPrisma.campaign.update.mockResolvedValue({
        id: "camp-auto",
        status: "APPROVED",
      });

      await service.approve("camp-auto", "admin");

      expect(mockEmailProviderService.send).not.toHaveBeenCalled();
    });

    it("campaign is SENT only after explicit queueEmails call", async () => {
      setupApprovedCampaign();
      mockContactServiceForCampaign.list.mockResolvedValue([
        { id: "c-x", email: "x@example.com" },
      ]);
      mockContactServiceForCampaign.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProviderService.send.mockResolvedValue("msg-x");

      await service.queueEmails("c-1", content);

      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "SENT" },
        }),
      );
    });

    it("campaignTouch.create called with touchType: SEND for each sent contact", async () => {
      setupApprovedCampaign();
      mockContactServiceForCampaign.list.mockResolvedValue([
        { id: "c-y", email: "y@example.com" },
      ]);
      mockContactServiceForCampaign.isMarketingEligible.mockResolvedValue(true);
      mockFrequencyCapService.isEligible.mockResolvedValue(true);
      mockEmailProviderService.send.mockResolvedValue("msg-y");

      await service.queueEmails("c-1", content);

      expect(mockPrisma.campaignTouch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactId: "c-y",
            touchType: "SEND",
          }),
        }),
      );
    });

    it("contact with email but ineligible does not get a campaignTouch", async () => {
      setupApprovedCampaign();
      mockContactServiceForCampaign.list.mockResolvedValue([
        { id: "c-z", email: "z@example.com" },
      ]);
      mockContactServiceForCampaign.isMarketingEligible.mockResolvedValue(
        false,
      );

      await service.queueEmails("c-1", content);

      expect(mockPrisma.campaignTouch.create).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("DRAFT campaign → updates to CANCELLED", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-d",
        name: "Draft",
        type: "NEWSLETTER",
        status: "DRAFT",
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: "camp-d",
        status: "CANCELLED",
      });

      await service.cancel("camp-d");

      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "CANCELLED" },
        }),
      );
    });

    it("SENT campaign → throws (cannot cancel)", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-s",
        name: "Sent",
        type: "NEWSLETTER",
        status: "SENT",
      });

      await expect(service.cancel("camp-s")).rejects.toThrow();
      expect(mockPrisma.campaign.update).not.toHaveBeenCalled();
    });

    it("CANCELLED campaign → throws (already cancelled)", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-c",
        name: "Cancelled",
        type: "NEWSLETTER",
        status: "CANCELLED",
      });

      await expect(service.cancel("camp-c")).rejects.toThrow();
    });

    it("APPROVED campaign can be cancelled", async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({
        id: "camp-a",
        name: "Approved",
        type: "NEWSLETTER",
        status: "APPROVED",
      });
      mockPrisma.campaign.update.mockResolvedValue({
        id: "camp-a",
        status: "CANCELLED",
      });

      await service.cancel("camp-a");

      expect(mockPrisma.campaign.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "CANCELLED" } }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// SECTION 8: EmailProviderService — mock-only
// ---------------------------------------------------------------------------

describe("EmailProviderService — mock provider", () => {
  let service: EmailProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProviderService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(EmailProviderService);
  });

  it("creates EmailMessage with deliveryStatus: QUEUED first", async () => {
    mockPrisma.emailMessage.create.mockResolvedValue({ id: "msg-1" });
    mockPrisma.emailMessage.update.mockResolvedValue({
      id: "msg-1",
      deliveryStatus: "SENT",
    });

    await service.send({
      to: "a@b.com",
      subject: "Hello",
      body: "<p>Hi</p>",
    });

    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryStatus: "QUEUED",
          to: "a@b.com",
          subject: "Hello",
        }),
      }),
    );
  });

  it("updates message to SENT with sentAt: Date after creation", async () => {
    mockPrisma.emailMessage.create.mockResolvedValue({ id: "msg-2" });
    mockPrisma.emailMessage.update.mockResolvedValue({
      id: "msg-2",
      deliveryStatus: "SENT",
    });

    await service.send({
      to: "b@c.com",
      subject: "Subject",
      body: "Body",
    });

    expect(mockPrisma.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "msg-2" },
        data: expect.objectContaining({
          deliveryStatus: "SENT",
          sentAt: expect.any(Date),
        }),
      }),
    );
  });

  it("create is called before update (correct order)", async () => {
    const callOrder: string[] = [];
    mockPrisma.emailMessage.create.mockImplementation(() => {
      callOrder.push("create");
      return Promise.resolve({ id: "msg-3" });
    });
    mockPrisma.emailMessage.update.mockImplementation(() => {
      callOrder.push("update");
      return Promise.resolve({ id: "msg-3" });
    });

    await service.send({ to: "c@d.com", subject: "S", body: "B" });

    expect(callOrder).toEqual(["create", "update"]);
  });

  it("returns the message id (from create result)", async () => {
    mockPrisma.emailMessage.create.mockResolvedValue({ id: "msg-returned" });
    mockPrisma.emailMessage.update.mockResolvedValue({
      id: "msg-returned",
      deliveryStatus: "SENT",
    });

    const result = await service.send({
      to: "d@e.com",
      subject: "Subject",
      body: "Body",
    });

    expect(result).toBe("msg-returned");
  });

  it("campaignId and contactId passed through to create data", async () => {
    mockPrisma.emailMessage.create.mockResolvedValue({ id: "msg-5" });
    mockPrisma.emailMessage.update.mockResolvedValue({ id: "msg-5" });

    await service.send({
      campaignId: "camp-1",
      contactId: "contact-1",
      to: "e@f.com",
      subject: "Subject",
      body: "Body",
    });

    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: "camp-1",
          contactId: "contact-1",
        }),
      }),
    );
  });

  it("no campaignId → campaignId: null in create", async () => {
    mockPrisma.emailMessage.create.mockResolvedValue({ id: "msg-6" });
    mockPrisma.emailMessage.update.mockResolvedValue({ id: "msg-6" });

    await service.send({ to: "f@g.com", subject: "S", body: "B" });

    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ campaignId: null }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// SECTION 9: GrowthContextService — aggregates, no PII
// ---------------------------------------------------------------------------

const mockAbandonedSvc = { getSummary: jest.fn() };
const mockReplenishmentSvc = { getCandidates: jest.fn() };
const mockSegmentSvc = { getSegmentSummary: jest.fn() };
const mockUpsellSvc = { listAll: jest.fn() };

function setupDefaultGrowthContextMocks(
  lastSyncOverride?: Partial<{ completedAt: Date; status: string }> | null,
) {
  mockAbandonedSvc.getSummary.mockResolvedValue({
    byStatus: { ACTIVE: 5, RECOVERED: 3, EXPIRED: 10, SUPPRESSED: 2 },
    activeCount: 5,
    activeTotalValue: 750.0,
  });
  mockReplenishmentSvc.getCandidates.mockResolvedValue([]);
  mockSegmentSvc.getSegmentSummary.mockResolvedValue([
    {
      id: "s-1",
      type: "LAPSED_CUSTOMER",
      name: "LAPSED_CUSTOMER",
      memberCount: 42,
      description: "180d",
    },
  ]);
  mockUpsellSvc.listAll.mockResolvedValue([
    {
      id: "r-1",
      source: "COMMERCE",
      strength: 0.8,
      sampleSize: 25,
      sourceProduct: { name: "Serum" },
      targetProduct: { name: "Balm", active: true },
      type: "CROSS_SELL",
    },
    {
      id: "r-2",
      source: "MANUAL",
      strength: null,
      sampleSize: null,
      sourceProduct: { name: "A" },
      targetProduct: { name: "B", active: true },
      type: "CROSS_SELL",
    },
  ]);
  mockPrisma.campaign.groupBy.mockResolvedValue([
    { status: "APPROVED", _count: { id: 2 } },
  ]);
  mockPrisma.abandonedCheckout.aggregate.mockResolvedValue({
    _count: { id: 15 },
  });
  mockPrisma.abandonedCheckout.findFirst.mockResolvedValue({
    currencyCode: "USD",
  });

  if (lastSyncOverride === null) {
    mockPrisma.growthSyncRun.findFirst.mockResolvedValue(null);
  } else if (lastSyncOverride) {
    mockPrisma.growthSyncRun.findFirst.mockResolvedValue({
      completedAt: lastSyncOverride.completedAt ?? new Date(),
      status: lastSyncOverride.status ?? "COMPLETED",
    });
  } else {
    mockPrisma.growthSyncRun.findFirst.mockResolvedValue({
      completedAt: new Date(),
      status: "COMPLETED",
    });
  }
}

describe("GrowthContextService — aggregates, no PII", () => {
  let service: GrowthContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrowthContextService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AbandonedCheckoutService, useValue: mockAbandonedSvc },
        { provide: ReplenishmentService, useValue: mockReplenishmentSvc },
        { provide: SegmentService, useValue: mockSegmentSvc },
        { provide: UpsellService, useValue: mockUpsellSvc },
      ],
    }).compile();
    service = module.get(GrowthContextService);
  });

  it("evidenceStatus=AVAILABLE when lastSync is recent (< 25h ago)", async () => {
    setupDefaultGrowthContextMocks({
      completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      status: "COMPLETED",
    });

    const ctx = await service.build();

    expect(ctx.evidenceStatus).toBe("AVAILABLE");
  });

  it("evidenceStatus=STALE when lastSync.completedAt is 26h ago", async () => {
    setupDefaultGrowthContextMocks({
      completedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      status: "COMPLETED",
    });

    const ctx = await service.build();

    expect(ctx.evidenceStatus).toBe("STALE");
  });

  it("evidenceStatus=UNAVAILABLE when growthSyncRun.findFirst returns null", async () => {
    setupDefaultGrowthContextMocks(null);

    const ctx = await service.build();

    expect(ctx.evidenceStatus).toBe("UNAVAILABLE");
  });

  it("recoveryRate = 3 / 15 = 0.2 (recovered/closed)", async () => {
    setupDefaultGrowthContextMocks();
    // byStatus.RECOVERED = 3, aggregate._count.id = 15

    const ctx = await service.build();

    expect(ctx.abandonedCheckouts.recoveryRate).toBeCloseTo(0.2);
  });

  it("recoveryRate null when closed count = 0", async () => {
    setupDefaultGrowthContextMocks();
    mockPrisma.abandonedCheckout.aggregate.mockResolvedValue({
      _count: { id: 0 },
    });

    const ctx = await service.build();

    expect(ctx.abandonedCheckouts.recoveryRate).toBeNull();
  });

  it("lapsedCustomerCount = 42 (from LAPSED_CUSTOMER segment)", async () => {
    setupDefaultGrowthContextMocks();

    const ctx = await service.build();

    expect(ctx.lapsedCustomerCount).toBe(42);
  });

  it("lapsedCustomerCount = 0 when no LAPSED_CUSTOMER segment found", async () => {
    setupDefaultGrowthContextMocks();
    mockSegmentSvc.getSegmentSummary.mockResolvedValue([
      { id: "s-2", type: "PROSPECT", name: "PROSPECT", memberCount: 10 },
    ]);

    const ctx = await service.build();

    expect(ctx.lapsedCustomerCount).toBe(0);
  });

  it("crossSellOpportunities filters: only COMMERCE source included (not MANUAL)", async () => {
    setupDefaultGrowthContextMocks();

    const ctx = await service.build();

    expect(ctx.crossSellOpportunities).toHaveLength(1);
    expect(ctx.crossSellOpportunities[0].sourceProduct).toBe("Serum");
    expect(ctx.crossSellOpportunities[0].targetProduct).toBe("Balm");
  });

  it("crossSellOpportunities limited to 10 (test with 11 COMMERCE recs → 10 returned)", async () => {
    setupDefaultGrowthContextMocks();

    const elevenRecs = Array.from({ length: 11 }, (_, i) => ({
      id: `r-${i}`,
      source: "COMMERCE",
      strength: (11 - i) / 100,
      sampleSize: 20,
      sourceProduct: { name: `Src ${i}` },
      targetProduct: { name: `Tgt ${i}`, active: true },
      type: "CROSS_SELL",
    }));
    mockUpsellSvc.listAll.mockResolvedValue(elevenRecs);

    const ctx = await service.build();

    expect(ctx.crossSellOpportunities).toHaveLength(10);
  });

  it("no email/phone/name fields in returned context", async () => {
    setupDefaultGrowthContextMocks();

    const ctx = await service.build();
    const ctxStr = JSON.stringify(ctx);

    expect(ctxStr).not.toMatch(/"email"/);
    expect(ctxStr).not.toMatch(/"phone"/);
    expect(ctxStr).not.toMatch(/"firstName"/);
    expect(ctxStr).not.toMatch(/"lastName"/);
  });

  it("activeCount and activeTotalValue come from abandonment summary", async () => {
    setupDefaultGrowthContextMocks();

    const ctx = await service.build();

    expect(ctx.abandonedCheckouts.activeCount).toBe(5);
    expect(ctx.abandonedCheckouts.activeTotalValue).toBe(750.0);
  });

  it("currencyCode defaults to USD when no row found", async () => {
    setupDefaultGrowthContextMocks();
    mockPrisma.abandonedCheckout.findFirst.mockResolvedValue(null);

    const ctx = await service.build();

    expect(ctx.abandonedCheckouts.currencyCode).toBe("USD");
  });

  it("campaigns record reflects groupBy result", async () => {
    setupDefaultGrowthContextMocks();
    mockPrisma.campaign.groupBy.mockResolvedValue([
      { status: "APPROVED", _count: { id: 3 } },
      { status: "SENT", _count: { id: 7 } },
    ]);

    const ctx = await service.build();

    expect(ctx.campaigns).toEqual({ APPROVED: 3, SENT: 7 });
  });

  it("segments array includes all segments from getSegmentSummary", async () => {
    setupDefaultGrowthContextMocks();
    mockSegmentSvc.getSegmentSummary.mockResolvedValue([
      {
        id: "s-1",
        type: "LAPSED_CUSTOMER",
        name: "LAPSED_CUSTOMER",
        memberCount: 42,
      },
      { id: "s-2", type: "VIP", name: "VIP", memberCount: 8 },
    ]);

    const ctx = await service.build();

    expect(ctx.segments).toHaveLength(2);
    expect(ctx.segments[0]).toMatchObject({
      type: "LAPSED_CUSTOMER",
      memberCount: 42,
    });
    expect(ctx.segments[1]).toMatchObject({ type: "VIP", memberCount: 8 });
  });

  it("crossSellOpportunities sorted by strength descending", async () => {
    setupDefaultGrowthContextMocks();
    mockUpsellSvc.listAll.mockResolvedValue([
      {
        id: "r-low",
        source: "COMMERCE",
        strength: 0.2,
        sampleSize: 15,
        sourceProduct: { name: "A" },
        targetProduct: { name: "B", active: true },
        type: "CROSS_SELL",
      },
      {
        id: "r-high",
        source: "COMMERCE",
        strength: 0.9,
        sampleSize: 30,
        sourceProduct: { name: "C" },
        targetProduct: { name: "D", active: true },
        type: "CROSS_SELL",
      },
    ]);

    const ctx = await service.build();

    expect(ctx.crossSellOpportunities[0].strength).toBe(0.9);
    expect(ctx.crossSellOpportunities[1].strength).toBe(0.2);
  });

  it("replenishmentCandidates aggregated by product with candidateCount", async () => {
    setupDefaultGrowthContextMocks();
    mockReplenishmentSvc.getCandidates.mockResolvedValue([
      {
        productId: "p-1",
        productName: "Night Balm",
        windowDays: 30,
        contacts: [
          { id: "c-1", email: "a@b.com", firstName: "Alice" },
          { id: "c-2", email: "b@c.com", firstName: "Bob" },
        ],
      },
    ]);

    const ctx = await service.build();

    expect(ctx.replenishmentCandidates).toHaveLength(1);
    expect(ctx.replenishmentCandidates[0]).toMatchObject({
      productName: "Night Balm",
      windowDays: 30,
      candidateCount: 2,
    });
    // No PII in output — contacts array itself not present
    expect(JSON.stringify(ctx.replenishmentCandidates)).not.toMatch(/"email"/);
  });
});

// ---------------------------------------------------------------------------
// SECTION 10: GrowthSyncService — orchestration + consent normalization
// ---------------------------------------------------------------------------

const mockShopifyForSync = {
  configured: true as boolean,
  fetchCustomers: jest.fn(),
  fetchAbandonedCheckouts: jest.fn(),
  fetchOrders: jest.fn(),
};

const mockContactSvcForSync = {
  findByShopifyId: jest.fn(),
  findByEmail: jest.fn(),
  upsert: jest.fn(),
};

const mockAbandonedSvcForSync = {
  reconcileWithOrders: jest.fn(),
  expireOld: jest.fn(),
};

function makeRawCustomer(overrides: Record<string, any> = {}) {
  return {
    id: "gid://shopify/Customer/1",
    email: "test@example.com",
    phone: null,
    firstName: "Test",
    lastName: "User",
    numberOfOrders: 2,
    amountSpent: { amount: "240.00", currencyCode: "USD" },
    emailMarketingConsent: { marketingState: "SUBSCRIBED" },
    smsMarketingConsent: { marketingState: "NOT_SUBSCRIBED" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("GrowthSyncService — orchestration + consent normalization", () => {
  let service: GrowthSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset configured each time
    mockShopifyForSync.configured = true;
    // isRunning() check — default: not running.
    mockPrisma.growthSyncRun.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrowthSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyGraphqlAdapter, useValue: mockShopifyForSync },
        { provide: ContactService, useValue: mockContactSvcForSync },
        {
          provide: AbandonedCheckoutService,
          useValue: mockAbandonedSvcForSync,
        },
      ],
    }).compile();
    service = module.get(GrowthSyncService);
  });

  function setupHappyPathMocks(customers: any[] = [makeRawCustomer()]) {
    mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-1" });
    mockPrisma.growthSyncRun.update.mockResolvedValue({});
    mockShopifyForSync.fetchCustomers.mockResolvedValue({
      items: customers,
      truncated: false,
    });
    mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
      items: [],
      truncated: false,
    });
    mockShopifyForSync.fetchOrders.mockResolvedValue({
      items: [],
      truncated: false,
    });
    mockContactSvcForSync.findByShopifyId.mockResolvedValue(null);
    mockContactSvcForSync.upsert.mockResolvedValue({});
    mockPrisma.abandonedCheckout.findUnique.mockResolvedValue(null);
    mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});
    mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
    mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);
  }

  describe("run — orchestration", () => {
    it("Shopify not configured → throws", async () => {
      mockShopifyForSync.configured = false;

      await expect(service.run()).rejects.toThrow(/Shopify not configured/);
      expect(mockPrisma.growthSyncRun.create).not.toHaveBeenCalled();
    });

    it("happy path: creates RUNNING run then updates to COMPLETED", async () => {
      setupHappyPathMocks();

      await service.run();

      expect(mockPrisma.growthSyncRun.create).toHaveBeenCalledWith({
        data: { brandId: BRAND_ID, status: "RUNNING" },
      });
      expect(mockPrisma.growthSyncRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });

    it("returns GrowthSyncResult with runId from created run", async () => {
      setupHappyPathMocks();
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-xyz" });

      const result = await service.run();

      expect(result.runId).toBe("run-xyz");
    });

    it("both customer sync and checkout sync fail → status FAILED", async () => {
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-fail" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});
      mockShopifyForSync.fetchCustomers.mockRejectedValue(
        new Error("Network error"),
      );
      mockShopifyForSync.fetchAbandonedCheckouts.mockRejectedValue(
        new Error("Network error 2"),
      );
      mockShopifyForSync.fetchOrders.mockRejectedValue(
        new Error("Network error 3"),
      );
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      const result = await service.run();

      expect(result.status).toBe("FAILED");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("customer sync fails but checkouts succeed → status PARTIAL", async () => {
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-partial" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});
      mockShopifyForSync.fetchCustomers.mockRejectedValue(
        new Error("Customer error"),
      );
      mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
        items: [makeRawCheckout()],
        truncated: false,
      });
      mockShopifyForSync.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockContactSvcForSync.findByEmail.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.findUnique.mockResolvedValue(null);
      mockPrisma.abandonedCheckout.upsert.mockResolvedValue({});
      mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      const result = await service.run();

      expect(result.status).toBe("PARTIAL");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("truncated customer list → errors includes truncation message", async () => {
      setupHappyPathMocks([makeRawCustomer()]);
      mockShopifyForSync.fetchCustomers.mockResolvedValue({
        items: [makeRawCustomer()],
        truncated: true,
      });

      const result = await service.run();

      expect(
        result.errors.some((e: string) => e.toLowerCase().includes("truncat")),
      ).toBe(true);
    });

    it("customersFetched count matches items returned", async () => {
      setupHappyPathMocks([makeRawCustomer(), makeRawCustomer()]);

      const result = await service.run();

      expect(result.customersFetched).toBe(2);
    });

    it("growthSyncRun.update called with completedAt Date", async () => {
      setupHappyPathMocks();

      await service.run();

      expect(mockPrisma.growthSyncRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("expireOld is called as part of sync run", async () => {
      setupHappyPathMocks();

      await service.run();

      expect(mockAbandonedSvcForSync.expireOld).toHaveBeenCalledTimes(1);
    });
  });

  describe("consent normalization via run()", () => {
    async function runWithMarketingState(marketingState: string | null) {
      jest.clearAllMocks();
      mockShopifyForSync.configured = true;
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-norm" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});

      const customerOverride =
        marketingState === null
          ? { emailMarketingConsent: null }
          : { emailMarketingConsent: { marketingState } };

      mockShopifyForSync.fetchCustomers.mockResolvedValue({
        items: [makeRawCustomer(customerOverride)],
        truncated: false,
      });
      mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockShopifyForSync.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockContactSvcForSync.findByShopifyId.mockResolvedValue(null);
      mockContactSvcForSync.upsert.mockResolvedValue({});
      mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      await service.run();

      return mockContactSvcForSync.upsert.mock.calls[0]?.[0];
    }

    it('"SUBSCRIBED" → emailMarketingStatus: "SUBSCRIBED"', async () => {
      const dto = await runWithMarketingState("SUBSCRIBED");
      expect(dto.emailMarketingStatus).toBe("SUBSCRIBED");
    });

    it('"UNSUBSCRIBED" → emailMarketingStatus: "UNSUBSCRIBED"', async () => {
      const dto = await runWithMarketingState("UNSUBSCRIBED");
      expect(dto.emailMarketingStatus).toBe("UNSUBSCRIBED");
    });

    it('"PENDING" → emailMarketingStatus: "PENDING"', async () => {
      const dto = await runWithMarketingState("PENDING");
      expect(dto.emailMarketingStatus).toBe("PENDING");
    });

    it('"REDACTED" → emailMarketingStatus: "REDACTED"', async () => {
      const dto = await runWithMarketingState("REDACTED");
      expect(dto.emailMarketingStatus).toBe("REDACTED");
    });

    it('"INVALID" → emailMarketingStatus: "NOT_SUBSCRIBED" (fail closed)', async () => {
      const dto = await runWithMarketingState("INVALID");
      expect(dto.emailMarketingStatus).toBe("NOT_SUBSCRIBED");
    });

    it('null consent → emailMarketingStatus: "NOT_SUBSCRIBED" (fail closed)', async () => {
      const dto = await runWithMarketingState(null);
      expect(dto.emailMarketingStatus).toBe("NOT_SUBSCRIBED");
    });

    it('"subscribed" (lowercase) → "SUBSCRIBED" (case-insensitive normalization)', async () => {
      const dto = await runWithMarketingState("subscribed");
      expect(dto.emailMarketingStatus).toBe("SUBSCRIBED");
    });

    it('"unknown_state" → "NOT_SUBSCRIBED" (unknown value → fail closed)', async () => {
      const dto = await runWithMarketingState("unknown_state");
      expect(dto.emailMarketingStatus).toBe("NOT_SUBSCRIBED");
    });

    it('"NOT_SUBSCRIBED" passes through as "NOT_SUBSCRIBED"', async () => {
      const dto = await runWithMarketingState("NOT_SUBSCRIBED");
      expect(dto.emailMarketingStatus).toBe("NOT_SUBSCRIBED");
    });

    it("contacts.upsert receives shopifyCustomerId from raw customer", async () => {
      const dto = await runWithMarketingState("SUBSCRIBED");
      expect(dto.shopifyCustomerId).toBe("gid://shopify/Customer/1");
    });

    it("contacts.upsert receives correct orderCount from raw customer", async () => {
      jest.clearAllMocks();
      mockShopifyForSync.configured = true;
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-oc" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});
      mockShopifyForSync.fetchCustomers.mockResolvedValue({
        items: [makeRawCustomer({ numberOfOrders: 7 })],
        truncated: false,
      });
      mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockShopifyForSync.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockContactSvcForSync.findByShopifyId.mockResolvedValue(null);
      mockContactSvcForSync.upsert.mockResolvedValue({});
      mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      await service.run();

      const dto = mockContactSvcForSync.upsert.mock.calls[0][0];
      expect(dto.orderCount).toBe(7);
    });

    it("contacts.upsert receives lifetimeRevenue as float parsed from amountSpent.amount", async () => {
      jest.clearAllMocks();
      mockShopifyForSync.configured = true;
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-ltv" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});
      mockShopifyForSync.fetchCustomers.mockResolvedValue({
        items: [
          makeRawCustomer({
            amountSpent: { amount: "999.99", currencyCode: "USD" },
          }),
        ],
        truncated: false,
      });
      mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockShopifyForSync.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockContactSvcForSync.findByShopifyId.mockResolvedValue(null);
      mockContactSvcForSync.upsert.mockResolvedValue({});
      mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      await service.run();

      const dto = mockContactSvcForSync.upsert.mock.calls[0][0];
      expect(dto.lifetimeRevenue).toBeCloseTo(999.99);
    });

    it("contactsCreated incremented for new contact (findByShopifyId returns null)", async () => {
      jest.clearAllMocks();
      mockShopifyForSync.configured = true;
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-new" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});
      mockShopifyForSync.fetchCustomers.mockResolvedValue({
        items: [makeRawCustomer()],
        truncated: false,
      });
      mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockShopifyForSync.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockContactSvcForSync.findByShopifyId.mockResolvedValue(null); // new
      mockContactSvcForSync.upsert.mockResolvedValue({});
      mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      const result = await service.run();

      expect(result.contactsCreated).toBe(1);
      expect(result.contactsUpdated).toBe(0);
    });

    it("concurrent run blocked — throws when isRunning() returns true", async () => {
      mockShopifyForSync.configured = true;
      mockPrisma.growthSyncRun.findFirst.mockResolvedValue({
        id: "running-run",
        status: "RUNNING",
      });

      await expect(service.run()).rejects.toThrow(/already running/i);
      expect(mockPrisma.growthSyncRun.create).not.toHaveBeenCalled();
    });

    it("contactsUpdated incremented for existing contact (findByShopifyId returns contact)", async () => {
      jest.clearAllMocks();
      mockShopifyForSync.configured = true;
      mockPrisma.growthSyncRun.create.mockResolvedValue({ id: "run-upd" });
      mockPrisma.growthSyncRun.update.mockResolvedValue({});
      mockShopifyForSync.fetchCustomers.mockResolvedValue({
        items: [makeRawCustomer()],
        truncated: false,
      });
      mockShopifyForSync.fetchAbandonedCheckouts.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockShopifyForSync.fetchOrders.mockResolvedValue({
        items: [],
        truncated: false,
      });
      mockContactSvcForSync.findByShopifyId.mockResolvedValue({
        id: "existing-c",
      }); // existing
      mockContactSvcForSync.upsert.mockResolvedValue({});
      mockAbandonedSvcForSync.reconcileWithOrders.mockResolvedValue(0);
      mockAbandonedSvcForSync.expireOld.mockResolvedValue(0);

      const result = await service.run();

      expect(result.contactsCreated).toBe(0);
      expect(result.contactsUpdated).toBe(1);
    });
  });
});
