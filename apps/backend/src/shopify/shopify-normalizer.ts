import type {
  CommerceProduct,
  CommerceOrder,
  CommerceMetrics,
  CommerceCustomerSummary,
  RevenueByProduct,
  InventorySnapshot,
} from "@ai-cmo/contracts";
import type {
  RawShopifyProduct,
  RawShopifyOrder,
} from "./shopify-graphql.adapter";

export function normalizeProduct(raw: RawShopifyProduct): CommerceProduct {
  const variants = raw.variants.edges.map(({ node: v }) => ({
    id: v.id,
    title: v.title,
    sku: v.sku ?? null,
    price: parseFloat(v.price),
    compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
    inventoryQuantity: v.inventoryQuantity,
    available: v.availableForSale,
  }));

  return {
    id: raw.id,
    title: raw.title,
    handle: raw.handle,
    status: raw.status as "ACTIVE" | "DRAFT" | "ARCHIVED",
    category: raw.productType ?? null,
    tags: raw.tags,
    variants,
    totalInventory: raw.totalInventory,
    minPrice: parseFloat(raw.priceRangeV2.minVariantPrice.amount),
    maxPrice: parseFloat(raw.priceRangeV2.maxVariantPrice.amount),
  };
}

// Returns null for orders that should be excluded from metrics.
export function normalizeOrder(raw: RawShopifyOrder): CommerceOrder | null {
  if (raw.cancelledAt) return null;
  if (raw.test) return null;
  const status = raw.financialStatus?.toUpperCase();
  if (status === "VOIDED" || status === "REFUNDED") return null;

  const grossPrice = parseFloat(raw.totalPriceSet.shopMoney.amount);
  const refunded = parseFloat(raw.totalRefundedSet?.shopMoney?.amount ?? "0");
  const totalPrice = Math.max(0, grossPrice - refunded);

  const lineItems = raw.lineItems.edges.map(({ node: li }) => ({
    productId: li.product?.id ?? null,
    productTitle: li.title,
    quantity: li.quantity,
    unitPrice: parseFloat(li.originalUnitPriceSet.shopMoney.amount),
  }));

  return {
    id: raw.id,
    createdAt: new Date(raw.createdAt),
    totalPrice,
    lineItems,
    customerEmail: raw.email ?? null,
    isRepeatCustomer: (raw.customer?.numberOfOrders ?? 1) > 1,
  };
}

export function computeMetrics(
  orders: CommerceOrder[],
  products: CommerceProduct[],
  periodStart: Date,
  periodEnd: Date,
  lowStockThreshold: number,
  previousOrders?: CommerceOrder[],
  currencyCode = "USD",
  metricsIncomplete = false,
): CommerceMetrics {
  const revenue = orders.reduce((sum, o) => sum + o.totalPrice, 0);
  const orderCount = orders.length;
  const aov = orderCount > 0 ? revenue / orderCount : 0;
  const unitsSold = orders.reduce(
    (sum, o) => sum + o.lineItems.reduce((s, li) => s + li.quantity, 0),
    0,
  );

  // Revenue grouped by product
  const productRevMap = new Map<
    string,
    { title: string; revenue: number; units: number }
  >();
  for (const order of orders) {
    for (const li of order.lineItems) {
      if (!li.productId) continue;
      const existing = productRevMap.get(li.productId);
      const lineRevenue = li.unitPrice * li.quantity;
      if (existing) {
        existing.revenue += lineRevenue;
        existing.units += li.quantity;
      } else {
        productRevMap.set(li.productId, {
          title: li.productTitle,
          revenue: lineRevenue,
          units: li.quantity,
        });
      }
    }
  }

  const revenueByProduct: RevenueByProduct[] = Array.from(
    productRevMap.entries(),
  )
    .map(([productId, data]) => ({
      productId,
      productTitle: data.title,
      revenue: data.revenue,
      units: data.units,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Low inventory products
  const lowInventoryProducts: InventorySnapshot[] = products
    .filter((p) => p.totalInventory <= lowStockThreshold)
    .map((p) => ({
      productId: p.id,
      productTitle: p.title,
      totalUnits: p.totalInventory,
      lowStock: true,
      variants: p.variants.map((v) => ({
        variantId: v.id,
        title: v.title,
        quantity: v.inventoryQuantity,
      })),
    }));

  // Customer summary — unique customers; repeat = unique emails with isRepeatCustomer
  const emails = orders.map((o) => o.customerEmail).filter(Boolean) as string[];
  const uniqueEmails = new Set(emails);
  const repeatCustomerEmails = new Set(
    orders
      .filter((o) => o.isRepeatCustomer && o.customerEmail)
      .map((o) => o.customerEmail as string),
  );
  const repeatCustomers = repeatCustomerEmails.size;
  const totalCustomers = uniqueEmails.size;
  const repeatRate = Math.min(
    1.0,
    totalCustomers > 0 ? repeatCustomers / totalCustomers : 0,
  );
  const customerSummary: CommerceCustomerSummary = {
    totalCustomers,
    repeatCustomers,
    repeatRate,
    newThisPeriod: totalCustomers - repeatCustomers,
  };

  // Previous period comparison
  let previousPeriod: CommerceMetrics["previousPeriod"] = null;
  if (previousOrders) {
    const prevRevenue = previousOrders.reduce((s, o) => s + o.totalPrice, 0);
    const prevCount = previousOrders.length;
    previousPeriod = {
      revenue: prevRevenue,
      orderCount: prevCount,
      aov: prevCount > 0 ? prevRevenue / prevCount : 0,
    };
  }

  return {
    periodStart,
    periodEnd,
    revenue,
    orderCount,
    aov,
    unitsSold,
    currencyCode,
    metricsIncomplete,
    revenueByProduct,
    lowInventoryProducts,
    customerSummary,
    previousPeriod,
  };
}
