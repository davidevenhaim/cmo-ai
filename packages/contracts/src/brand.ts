import { z } from "zod";
import { CommerceContextSchema } from "./commerce";
import { ResearchContextSchema } from "./research";

export const BrandSourceSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  type: z.enum(["manual", "website", "document", "integration"]),
  label: z.string(),
  url: z.string().nullable(),
  fetchedAt: z.date().nullable(),
  createdAt: z.date(),
});

export const BrandFactSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  category: z.string(),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  sourceId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const BrandGuidelineSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  category: z.string(),
  rule: z.string(),
  example: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const ProductSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  price: z.number().nullable(),
  tags: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const BrandSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  voice: z.string().nullable(),
  audience: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  facts: z.array(BrandFactSchema).optional(),
  guidelines: z.array(BrandGuidelineSchema).optional(),
  sources: z.array(BrandSourceSchema).optional(),
  products: z.array(ProductSchema).optional(),
});

export type Brand = z.infer<typeof BrandSchema>;
export type BrandFact = z.infer<typeof BrandFactSchema>;
export type BrandGuideline = z.infer<typeof BrandGuidelineSchema>;
export type BrandSource = z.infer<typeof BrandSourceSchema>;
export type Product = z.infer<typeof ProductSchema>;

export const GrowthContextSchema = z.object({
  // AVAILABLE = fresh from DB; STALE = last-sync data, Shopify currently unavailable;
  // UNAVAILABLE = no sync ever completed or DB empty.
  evidenceStatus: z
    .enum(["AVAILABLE", "STALE", "UNAVAILABLE"])
    .default("AVAILABLE"),
  lastSyncAt: z.date().optional(),
  abandonedCheckouts: z.object({
    activeCount: z.number().int(),
    activeTotalValue: z.number(),
    currencyCode: z.string(),
    recoveryRate: z.number().nullable(),
  }),
  replenishmentCandidates: z.array(
    z.object({
      productName: z.string(),
      windowDays: z.number().int(),
      candidateCount: z.number().int(),
    }),
  ),
  lapsedCustomerCount: z.number().int(),
  segments: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      memberCount: z.number().int(),
    }),
  ),
  crossSellOpportunities: z.array(
    z.object({
      sourceProduct: z.string(),
      targetProduct: z.string(),
      strength: z.number(),
      sampleSize: z.number().int().nullable(),
    }),
  ),
  campaigns: z.record(z.string(), z.number().int()),
});

export const BrandContextSchema = z.object({
  brand: BrandSchema,
  facts: z.array(BrandFactSchema),
  guidelines: z.array(BrandGuidelineSchema),
  products: z.array(ProductSchema),
  hint: z.string().optional(),
  commerceContext: CommerceContextSchema.optional(),
  researchContext: ResearchContextSchema.optional(),
  growthContext: GrowthContextSchema.optional(),
});

export type GrowthContext = z.infer<typeof GrowthContextSchema>;
export type BrandContext = z.infer<typeof BrandContextSchema>;
