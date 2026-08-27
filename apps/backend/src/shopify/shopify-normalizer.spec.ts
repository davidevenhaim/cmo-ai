import {
  normalizeProduct,
  normalizeOrder,
  computeMetrics,
} from "./shopify-normalizer";
import type {
  RawShopifyProduct,
  RawShopifyOrder,
} from "./shopify-graphql.adapter";

const rawProduct: RawShopifyProduct = {
  id: "gid://shopify/Product/1",
  title: "Barrier Repair Serum",
  handle: "barrier-repair-serum",
  status: "ACTIVE",
  productType: "Serum",
  tags: ["ceramide", "sensitive"],
  totalInventory: 42,
  variants: {
    edges: [
      {
        node: {
          id: "gid://shopify/ProductVariant/10",
          title: "30ml",
          sku: "BRS-30",
          price: "68.00",
          compareAtPrice: "85.00",
          inventoryQuantity: 42,
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

const rawOrder: RawShopifyOrder = {
  id: "gid://shopify/Order/100",
  createdAt: "2024-06-01T10:00:00Z",
  cancelledAt: null,
  test: false,
  financialStatus: "paid",
  totalPriceSet: { shopMoney: { amount: "136.00", currencyCode: "USD" } },
  totalRefundedSet: { shopMoney: { amount: "0.00" } },
  email: "customer@example.com",
  checkoutToken: null,
  customer: { numberOfOrders: 3 },
  lineItems: {
    edges: [
      {
        node: {
          product: { id: "gid://shopify/Product/1" },
          title: "Barrier Repair Serum",
          quantity: 2,
          originalUnitPriceSet: { shopMoney: { amount: "68.00" } },
        },
      },
    ],
  },
};

describe("normalizeProduct", () => {
  it("maps raw Shopify product to CommerceProduct", () => {
    const p = normalizeProduct(rawProduct);
    expect(p.id).toBe("gid://shopify/Product/1");
    expect(p.title).toBe("Barrier Repair Serum");
    expect(p.status).toBe("ACTIVE");
    expect(p.category).toBe("Serum");
    expect(p.tags).toEqual(["ceramide", "sensitive"]);
    expect(p.totalInventory).toBe(42);
    expect(p.minPrice).toBe(68);
    expect(p.maxPrice).toBe(68);
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0].compareAtPrice).toBe(85);
    expect(p.variants[0].available).toBe(true);
  });

  it("sets category null when productType is null", () => {
    const p = normalizeProduct({ ...rawProduct, productType: null });
    expect(p.category).toBeNull();
  });
});

describe("normalizeOrder", () => {
  it("maps raw Shopify order to CommerceOrder", () => {
    const o = normalizeOrder(rawOrder);
    expect(o).not.toBeNull();
    expect(o!.id).toBe("gid://shopify/Order/100");
    expect(o!.totalPrice).toBe(136);
    expect(o!.isRepeatCustomer).toBe(true);
    expect(o!.lineItems).toHaveLength(1);
    expect(o!.lineItems[0].quantity).toBe(2);
    expect(o!.lineItems[0].unitPrice).toBe(68);
  });

  it("marks first-time customer as not repeat", () => {
    const o = normalizeOrder({ ...rawOrder, customer: { numberOfOrders: 1 } });
    expect(o).not.toBeNull();
    expect(o!.isRepeatCustomer).toBe(false);
  });

  it("handles null customer", () => {
    const o = normalizeOrder({ ...rawOrder, customer: null });
    expect(o).not.toBeNull();
    expect(o!.isRepeatCustomer).toBe(false);
  });

  it("returns null for cancelled orders", () => {
    const o = normalizeOrder({
      ...rawOrder,
      cancelledAt: "2024-06-01T11:00:00Z",
    });
    expect(o).toBeNull();
  });

  it("returns null for test orders", () => {
    const o = normalizeOrder({ ...rawOrder, test: true });
    expect(o).toBeNull();
  });

  it("returns null for voided orders", () => {
    const o = normalizeOrder({ ...rawOrder, financialStatus: "voided" });
    expect(o).toBeNull();
  });

  it("returns null for fully refunded orders", () => {
    const o = normalizeOrder({ ...rawOrder, financialStatus: "refunded" });
    expect(o).toBeNull();
  });

  it("subtracts partial refund from totalPrice", () => {
    const o = normalizeOrder({
      ...rawOrder,
      totalPriceSet: { shopMoney: { amount: "136.00", currencyCode: "USD" } },
      totalRefundedSet: { shopMoney: { amount: "36.00" } },
    });
    expect(o).not.toBeNull();
    expect(o!.totalPrice).toBe(100);
  });
});

describe("computeMetrics", () => {
  const products = [normalizeProduct(rawProduct)];
  const orders = [normalizeOrder(rawOrder)!];
  const periodStart = new Date("2024-06-01");
  const periodEnd = new Date("2024-06-30");

  it("calculates revenue, order count, aov, units sold", () => {
    const m = computeMetrics(orders, products, periodStart, periodEnd, 5);
    expect(m.revenue).toBe(136);
    expect(m.orderCount).toBe(1);
    expect(m.aov).toBe(136);
    expect(m.unitsSold).toBe(2);
  });

  it("groups revenue by product", () => {
    const m = computeMetrics(orders, products, periodStart, periodEnd, 5);
    expect(m.revenueByProduct).toHaveLength(1);
    expect(m.revenueByProduct[0].productId).toBe("gid://shopify/Product/1");
    expect(m.revenueByProduct[0].revenue).toBe(136);
  });

  it("flags low stock products when inventory <= threshold", () => {
    const lowProduct = normalizeProduct({ ...rawProduct, totalInventory: 3 });
    const m = computeMetrics(orders, [lowProduct], periodStart, periodEnd, 5);
    expect(m.lowInventoryProducts).toHaveLength(1);
    expect(m.lowInventoryProducts[0].lowStock).toBe(true);
  });

  it("does not flag products above threshold", () => {
    const m = computeMetrics(orders, products, periodStart, periodEnd, 5);
    expect(m.lowInventoryProducts).toHaveLength(0);
  });

  it("includes previous period comparison when provided", () => {
    const prevOrder = normalizeOrder({
      ...rawOrder,
      id: "o2",
      totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    })!;
    const m = computeMetrics(orders, products, periodStart, periodEnd, 5, [
      prevOrder,
    ]);
    expect(m.previousPeriod).not.toBeNull();
    expect(m.previousPeriod!.revenue).toBe(100);
  });

  it("returns zero aov when no orders", () => {
    const m = computeMetrics([], products, periodStart, periodEnd, 5);
    expect(m.aov).toBe(0);
    expect(m.revenue).toBe(0);
    expect(m.orderCount).toBe(0);
  });

  it("counts repeat customers as unique emails, not order count", () => {
    // Two orders from same repeat customer — should count as 1 repeat customer
    const order2 = normalizeOrder({ ...rawOrder, id: "o2" })!;
    const m = computeMetrics(
      [orders[0], order2],
      products,
      periodStart,
      periodEnd,
      5,
    );
    expect(m.customerSummary!.repeatCustomers).toBe(1);
  });

  it("repeat rate never exceeds 1.0", () => {
    const m = computeMetrics(orders, products, periodStart, periodEnd, 5);
    expect(m.customerSummary!.repeatRate).toBeLessThanOrEqual(1.0);
  });

  it("propagates currencyCode and metricsIncomplete", () => {
    const m = computeMetrics(
      orders,
      products,
      periodStart,
      periodEnd,
      5,
      undefined,
      "GBP",
      true,
    );
    expect(m.currencyCode).toBe("GBP");
    expect(m.metricsIncomplete).toBe(true);
  });
});
