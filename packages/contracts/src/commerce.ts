import { z } from "zod";

export const CommerceEvidenceStatusSchema = z.enum([
  "AVAILABLE",
  "STALE",
  "UNAVAILABLE",
]);

export const CommerceVariantSchema = z.object({
  id: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  price: z.number(),
  compareAtPrice: z.number().nullable(),
  inventoryQuantity: z.number(),
  available: z.boolean(),
});

export const CommerceProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  handle: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  variants: z.array(CommerceVariantSchema),
  totalInventory: z.number(),
  minPrice: z.number(),
  maxPrice: z.number(),
});

export const InventorySnapshotSchema = z.object({
  productId: z.string(),
  productTitle: z.string(),
  totalUnits: z.number(),
  lowStock: z.boolean(),
  variants: z.array(
    z.object({
      variantId: z.string(),
      title: z.string(),
      quantity: z.number(),
    }),
  ),
});

export const CommerceOrderLineItemSchema = z.object({
  productId: z.string().nullable(),
  productTitle: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
});

export const CommerceOrderSchema = z.object({
  id: z.string(),
  createdAt: z.coerce.date(),
  totalPrice: z.number(),
  lineItems: z.array(CommerceOrderLineItemSchema),
  customerEmail: z.string().nullable(),
  isRepeatCustomer: z.boolean(),
});

export const CommerceCustomerSummarySchema = z.object({
  totalCustomers: z.number(),
  repeatCustomers: z.number(),
  repeatRate: z.number(),
  newThisPeriod: z.number(),
});

export const RevenueByProductSchema = z.object({
  productId: z.string(),
  productTitle: z.string(),
  revenue: z.number(),
  units: z.number(),
});

export const CommerceMetricsSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  revenue: z.number(),
  orderCount: z.number(),
  aov: z.number(),
  unitsSold: z.number(),
  currencyCode: z.string().default("USD"),
  metricsIncomplete: z.boolean().default(false),
  revenueByProduct: z.array(RevenueByProductSchema),
  lowInventoryProducts: z.array(InventorySnapshotSchema),
  customerSummary: CommerceCustomerSummarySchema.nullable(),
  previousPeriod: z
    .object({
      revenue: z.number().optional(),
      orderCount: z.number().optional(),
      aov: z.number().optional(),
    })
    .nullable(),
});

export const CommerceContextSchema = z.object({
  fetchedAt: z.coerce.date(),
  shopName: z.string().nullable(),
  evidenceStatus: CommerceEvidenceStatusSchema,
  metrics: CommerceMetricsSchema.nullable(),
  topProducts: z.array(CommerceProductSchema),
  failureReason: z.string().nullable(),
  snapshotId: z.string().optional(),
});

export type CommerceEvidenceStatus = z.infer<
  typeof CommerceEvidenceStatusSchema
>;
export type CommerceVariant = z.infer<typeof CommerceVariantSchema>;
export type CommerceProduct = z.infer<typeof CommerceProductSchema>;
export type InventorySnapshot = z.infer<typeof InventorySnapshotSchema>;
export type CommerceOrderLineItem = z.infer<typeof CommerceOrderLineItemSchema>;
export type CommerceOrder = z.infer<typeof CommerceOrderSchema>;
export type CommerceCustomerSummary = z.infer<
  typeof CommerceCustomerSummarySchema
>;
export type RevenueByProduct = z.infer<typeof RevenueByProductSchema>;
export type CommerceMetrics = z.infer<typeof CommerceMetricsSchema>;
export type CommerceContext = z.infer<typeof CommerceContextSchema>;
