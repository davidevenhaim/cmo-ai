import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

const TRANSACTIONAL_SIGNALS = [
  "buy",
  "purchase",
  "order",
  "shop",
  "price",
  "cost",
  "cheap",
  "deal",
  "discount",
  "sale",
  "where to get",
  "near me",
  "free shipping",
  "coupon",
];
const COMMERCIAL_SIGNALS = [
  "best",
  "top",
  "review",
  "vs",
  "versus",
  "compare",
  "comparison",
  "alternative",
  "recommend",
  "worth it",
  "better",
  "ranked",
  "rating",
];
const INFORMATIONAL_SIGNALS = [
  "what is",
  "how to",
  "why does",
  "when to",
  "who makes",
  "does it",
  "can you",
  "will it",
  "is it",
  "are they",
  "guide",
  "tutorial",
  "learn",
  "explained",
  "overview",
  "introduction",
  "benefits of",
];
const PROBLEM_SIGNALS = [
  "how to fix",
  "why does",
  "problem with",
  "issue",
  "help with",
  "solution for",
  "remedy",
  "treatment for",
  "cure",
  "dry skin",
  "irritated",
];
const NAVIGATIONAL_SIGNALS = [
  "website",
  "login",
  "sign in",
  "contact",
  "official",
  "store",
];

export type SearchIntent =
  | "INFORMATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "NAVIGATIONAL"
  | "PROBLEM_AWARE"
  | "PRODUCT_AWARE"
  | "BRAND";

@Injectable()
export class KeywordIntentService {
  private readonly logger = new Logger(KeywordIntentService.name);

  constructor(private readonly prisma: PrismaService) {}

  classifyKeyword(keyword: string, brandName?: string): SearchIntent {
    const kw = keyword.toLowerCase();

    // Brand exact match → BRAND
    if (brandName && kw.includes(brandName.toLowerCase())) return "BRAND";

    // TRANSACTIONAL
    if (TRANSACTIONAL_SIGNALS.some((s) => kw.includes(s)))
      return "TRANSACTIONAL";

    // COMMERCIAL
    if (COMMERCIAL_SIGNALS.some((s) => kw.includes(s))) return "COMMERCIAL";

    // PROBLEM_AWARE
    if (PROBLEM_SIGNALS.some((s) => kw.includes(s))) return "PROBLEM_AWARE";

    // NAVIGATIONAL
    if (NAVIGATIONAL_SIGNALS.some((s) => kw.includes(s))) return "NAVIGATIONAL";

    // INFORMATIONAL — question starters
    if (/^(what|how|why|when|who|does|can|will|is|are)\b/.test(kw))
      return "INFORMATIONAL";
    if (INFORMATIONAL_SIGNALS.some((s) => kw.includes(s)))
      return "INFORMATIONAL";

    // PRODUCT_AWARE — contains product-category words
    const productWords = [
      "moisturizer",
      "balm",
      "cream",
      "serum",
      "oil",
      "butter",
      "lotion",
      "skincare",
      "tallow",
      "face",
      "skin",
      "lip",
    ];
    if (productWords.some((p) => kw.includes(p))) return "PRODUCT_AWARE";

    return "INFORMATIONAL";
  }

  async classifyAll(): Promise<number> {
    const brand = await this.prisma.brand.findUnique({
      where: { id: BRAND_ID },
      select: { name: true },
    });

    const unclassified = await this.prisma.keyword.findMany({
      where: { brandId: BRAND_ID, intentClassifiedAt: null, active: true },
    });

    let count = 0;
    for (const kw of unclassified) {
      const intent = this.classifyKeyword(kw.keyword, brand?.name);
      await this.prisma.keyword.update({
        where: { id: kw.id },
        data: { intent, intentClassifiedAt: new Date() },
      });
      count++;
    }

    this.logger.log(`Classified intent for ${count} keywords`);
    return count;
  }
}
