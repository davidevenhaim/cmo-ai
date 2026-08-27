import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { ShopifyGraphqlAdapter } from "./shopify-graphql.adapter";
import { of } from "rxjs";

const mockHttpService = { post: jest.fn() };
const mockConfigService = { get: jest.fn() };

function makeAxiosResponse(data: unknown) {
  return of({ data: { data } });
}

function makeProductsPage(
  nodes: unknown[],
  hasNextPage = false,
  endCursor = "cursor1",
) {
  return {
    products: {
      pageInfo: { hasNextPage, endCursor },
      edges: nodes.map((node) => ({ node })),
    },
  };
}

function makeOrdersPage(
  nodes: unknown[],
  hasNextPage = false,
  endCursor = "cursor1",
) {
  return {
    orders: {
      pageInfo: { hasNextPage, endCursor },
      edges: nodes.map((node) => ({ node })),
    },
  };
}

const rawVariant = {
  id: "v1",
  title: "Default",
  sku: null,
  price: "68.00",
  compareAtPrice: null,
  inventoryQuantity: 10,
  availableForSale: true,
};

const rawProductNode = {
  id: "p1",
  title: "Serum",
  handle: "serum",
  status: "ACTIVE",
  productType: null,
  tags: [],
  totalInventory: 10,
  variants: { edges: [{ node: rawVariant }] },
  priceRangeV2: {
    minVariantPrice: { amount: "68.00" },
    maxVariantPrice: { amount: "68.00" },
  },
};

describe("ShopifyGraphqlAdapter", () => {
  let adapter: ShopifyGraphqlAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopifyGraphqlAdapter,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    adapter = module.get<ShopifyGraphqlAdapter>(ShopifyGraphqlAdapter);
    jest.clearAllMocks();

    mockConfigService.get.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        SHOPIFY_SHOP_DOMAIN: "test.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: "shpat_test",
        SHOPIFY_API_VERSION: "2024-10",
        SHOPIFY_REQUEST_TIMEOUT_MS: "10000",
      };
      return map[key];
    });
  });

  describe("configured", () => {
    it("returns true when domain and token set", () => {
      expect(adapter.configured).toBe(true);
    });

    it("returns false when token missing", () => {
      mockConfigService.get.mockReturnValue(undefined);
      expect(adapter.configured).toBe(false);
    });

    it("returns false for placeholder domain values", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "SHOPIFY_SHOP_DOMAIN") return "your-domain.myshopify.com";
        if (key === "SHOPIFY_ACCESS_TOKEN") return "shpat_test";
        return undefined;
      });
      expect(adapter.configured).toBe(false);
    });

    it("returns false for placeholder token values", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "SHOPIFY_SHOP_DOMAIN") return "test.myshopify.com";
        if (key === "SHOPIFY_ACCESS_TOKEN") return "your-access-token";
        return undefined;
      });
      expect(adapter.configured).toBe(false);
    });

    it("returns false for unmodified .env.example domain (your-store.myshopify.com)", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "SHOPIFY_SHOP_DOMAIN") return "your-store.myshopify.com";
        if (key === "SHOPIFY_ACCESS_TOKEN") return "shpat_test";
        return undefined;
      });
      expect(adapter.configured).toBe(false);
    });

    it("returns false for unmodified .env.example token (shpat_...)", () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "SHOPIFY_SHOP_DOMAIN") return "test.myshopify.com";
        if (key === "SHOPIFY_ACCESS_TOKEN") return "shpat_...";
        return undefined;
      });
      expect(adapter.configured).toBe(false);
    });
  });

  describe("fetchProducts", () => {
    it("returns items array and truncated=false on single page", async () => {
      mockHttpService.post.mockReturnValue(
        makeAxiosResponse(makeProductsPage([rawProductNode], false)),
      );

      const result = await adapter.fetchProducts();

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe("Serum");
      expect(result.truncated).toBe(false);
    });

    it("follows cursor pagination across pages", async () => {
      mockHttpService.post
        .mockReturnValueOnce(
          makeAxiosResponse(makeProductsPage([rawProductNode], true, "c1")),
        )
        .mockReturnValueOnce(
          makeAxiosResponse(makeProductsPage([rawProductNode], false)),
        );

      const result = await adapter.fetchProducts();

      expect(result.items).toHaveLength(2);
      expect(mockHttpService.post).toHaveBeenCalledTimes(2);
      // Second call should include cursor
      const secondCallBody = mockHttpService.post.mock.calls[1][1];
      expect(secondCallBody.query).toContain('after: "c1"');
    });
  });

  describe("fetchOrders", () => {
    it("passes sinceDate and untilDate as bounded query", async () => {
      mockHttpService.post.mockReturnValue(
        makeAxiosResponse(makeOrdersPage([], false)),
      );

      const since = new Date("2024-06-01");
      const until = new Date("2024-06-30");
      await adapter.fetchOrders(since, until);

      const body = mockHttpService.post.mock.calls[0][1];
      expect(body.query).toContain("created_at:>=2024-06-01");
      expect(body.query).toContain("created_at:<2024-06-30");
    });

    it("returns truncated=false on single page", async () => {
      mockHttpService.post.mockReturnValue(
        makeAxiosResponse(makeOrdersPage([], false)),
      );

      const result = await adapter.fetchOrders(new Date(), new Date());
      expect(result.truncated).toBe(false);
    });
  });

  it("fetchShopName returns shop name", async () => {
    mockHttpService.post.mockReturnValue(
      makeAxiosResponse({ shop: { name: "Luminesce Store" } }),
    );
    const name = await adapter.fetchShopName();
    expect(name).toBe("Luminesce Store");
  });

  it("fetchCurrencyCode returns currency code", async () => {
    mockHttpService.post.mockReturnValue(
      makeAxiosResponse({ shop: { currencyCode: "USD" } }),
    );
    const code = await adapter.fetchCurrencyCode();
    expect(code).toBe("USD");
  });

  it("throws when GraphQL errors returned", async () => {
    mockHttpService.post.mockReturnValue(
      of({ data: { errors: [{ message: "Access denied" }] } }),
    );
    await expect(adapter.fetchProducts()).rejects.toThrow("Shopify GraphQL");
  });

  // ── M6.6: fetchCustomers pagination ──────────────────────────────────────

  function makeCustomerNode(overrides: Partial<Record<string, unknown>> = {}) {
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

  function makeCustomersPage(
    nodes: unknown[],
    hasNextPage = false,
    endCursor = "cust-cursor1",
  ) {
    return {
      customers: {
        pageInfo: { hasNextPage, endCursor },
        edges: nodes.map((node) => ({ node })),
      },
    };
  }

  describe("fetchCustomers", () => {
    it("returns single page of customers with truncated=false", async () => {
      const customer = makeCustomerNode();
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCustomersPage([customer])),
      );

      const result = await adapter.fetchCustomers();

      expect(result.items).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(result.items[0].id).toBe("gid://shopify/Customer/1");
    });

    it("follows cursor pagination across two pages", async () => {
      const page1 = makeCustomersPage(
        [makeCustomerNode({ id: "gid://shopify/Customer/1" })],
        true,
        "cursor-p1",
      );
      const page2 = makeCustomersPage(
        [makeCustomerNode({ id: "gid://shopify/Customer/2" })],
        false,
      );
      mockHttpService.post
        .mockReturnValueOnce(makeAxiosResponse(page1))
        .mockReturnValueOnce(makeAxiosResponse(page2));

      const result = await adapter.fetchCustomers();

      expect(result.items).toHaveLength(2);
      expect(result.truncated).toBe(false);
      // Second call must include the cursor from page 1
      const secondCallBody = mockHttpService.post.mock.calls[1][1] as {
        query: string;
      };
      expect(secondCallBody.query).toContain("cursor-p1");
    });

    it("sets truncated=true and warns when 10 pages exhausted", async () => {
      // Return hasNextPage=true for all 10 pages (adapter caps at 10)
      const fullPage = makeCustomersPage(
        [makeCustomerNode()],
        true,
        "cursor-N",
      );
      for (let i = 0; i < 10; i++) {
        mockHttpService.post.mockReturnValueOnce(makeAxiosResponse(fullPage));
      }

      const result = await adapter.fetchCustomers();

      expect(result.truncated).toBe(true);
      expect(mockHttpService.post).toHaveBeenCalledTimes(10);
    });

    it("includes emailMarketingConsent and smsMarketingConsent fields in query", async () => {
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCustomersPage([])),
      );
      await adapter.fetchCustomers();

      const queryBody = mockHttpService.post.mock.calls[0][1] as {
        query: string;
      };
      expect(queryBody.query).toContain("emailMarketingConsent");
      expect(queryBody.query).toContain("smsMarketingConsent");
      expect(queryBody.query).toContain("numberOfOrders");
      expect(queryBody.query).toContain("amountSpent");
    });

    it("returns empty items array when no customers", async () => {
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCustomersPage([])),
      );
      const result = await adapter.fetchCustomers();
      expect(result.items).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });
  });

  // ── M6.6: fetchAbandonedCheckouts pagination ─────────────────────────────

  function makeCheckoutNode(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "gid://shopify/AbandonedCheckout/1",
      token: "tok-abc123",
      abandonedCheckoutUrl: "https://store.myshopify.com/recover/tok-abc123",
      createdAt: new Date().toISOString(),
      totalPriceSet: { shopMoney: { amount: "120.00", currencyCode: "USD" } },
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
              title: "Barrier Repair Serum",
              quantity: 1,
              variant: {
                id: "var-1",
                sku: "SKU-001",
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

  function makeCheckoutsPage(
    nodes: unknown[],
    hasNextPage = false,
    endCursor = "co-cursor1",
  ) {
    return {
      abandonedCheckouts: {
        pageInfo: { hasNextPage, endCursor },
        edges: nodes.map((node) => ({ node })),
      },
    };
  }

  describe("fetchAbandonedCheckouts", () => {
    it("returns single page with truncated=false", async () => {
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCheckoutsPage([makeCheckoutNode()])),
      );

      const result = await adapter.fetchAbandonedCheckouts();

      expect(result.items).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(result.items[0].token).toBe("tok-abc123");
    });

    it("follows cursor pagination across two pages", async () => {
      const page1 = makeCheckoutsPage(
        [makeCheckoutNode({ id: "gid://shopify/AbandonedCheckout/1" })],
        true,
        "cursor-p1",
      );
      const page2 = makeCheckoutsPage(
        [makeCheckoutNode({ id: "gid://shopify/AbandonedCheckout/2" })],
        false,
      );
      mockHttpService.post
        .mockReturnValueOnce(makeAxiosResponse(page1))
        .mockReturnValueOnce(makeAxiosResponse(page2));

      const result = await adapter.fetchAbandonedCheckouts();

      expect(result.items).toHaveLength(2);
      const secondCallBody = mockHttpService.post.mock.calls[1][1] as {
        query: string;
      };
      expect(secondCallBody.query).toContain("cursor-p1");
    });

    it("sets truncated=true when 10 pages exhausted", async () => {
      const fullPage = makeCheckoutsPage([makeCheckoutNode()], true, "co-N");
      for (let i = 0; i < 10; i++) {
        mockHttpService.post.mockReturnValueOnce(makeAxiosResponse(fullPage));
      }

      const result = await adapter.fetchAbandonedCheckouts();

      expect(result.truncated).toBe(true);
      expect(mockHttpService.post).toHaveBeenCalledTimes(10);
    });

    it("query uses status:open filter", async () => {
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCheckoutsPage([])),
      );
      await adapter.fetchAbandonedCheckouts();

      const queryBody = mockHttpService.post.mock.calls[0][1] as {
        query: string;
      };
      expect(queryBody.query).toContain("status:open");
    });

    it("query requests abandonedCheckoutUrl and token fields", async () => {
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCheckoutsPage([])),
      );
      await adapter.fetchAbandonedCheckouts();

      const queryBody = mockHttpService.post.mock.calls[0][1] as {
        query: string;
      };
      expect(queryBody.query).toContain("abandonedCheckoutUrl");
      expect(queryBody.query).toContain("token");
    });

    it("handles anonymous checkout (customer: null)", async () => {
      const anonymousCheckout = makeCheckoutNode({ customer: null });
      mockHttpService.post.mockReturnValueOnce(
        makeAxiosResponse(makeCheckoutsPage([anonymousCheckout])),
      );

      const result = await adapter.fetchAbandonedCheckouts();

      expect(result.items[0].customer).toBeNull();
    });
  });

  // ── M6.6: orders include checkoutToken ───────────────────────────────────

  describe("fetchOrders — checkoutToken field", () => {
    it("includes checkoutToken in order query", async () => {
      const orderPage = makeOrdersPage([]);
      mockHttpService.post.mockReturnValueOnce(makeAxiosResponse(orderPage));

      await adapter.fetchOrders(new Date("2024-01-01"), new Date("2024-02-01"));

      const queryBody = mockHttpService.post.mock.calls[0][1] as {
        query: string;
      };
      expect(queryBody.query).toContain("checkoutToken");
    });
  });
});
