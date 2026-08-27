import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import type { SearchConsoleRow } from "./providers/search-console.provider";
import type { KeywordIdeaResult } from "./providers/keyword-planner.provider";

const BRAND_ID = "luminesce-brand-001";

// Stop words excluded from keyword extraction
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "up",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "what",
  "which",
  "who",
  "when",
  "where",
  "why",
  "how",
  "all",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
]);

@Injectable()
export class KeywordUniverseService {
  private readonly logger = new Logger(KeywordUniverseService.name);

  constructor(private readonly prisma: PrismaService) {}

  normalizeKeyword(keyword: string): string {
    return keyword
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9\s\-']/g, "")
      .trim();
  }

  async addKeyword(
    keyword: string,
    source: string,
    relevance = 0.5,
    topic?: string,
  ): Promise<void> {
    const normalizedKeyword = this.normalizeKeyword(keyword);
    if (!normalizedKeyword || normalizedKeyword.length < 2) return;

    await this.prisma.keyword.upsert({
      where: {
        brandId_normalizedKeyword_language_country: {
          brandId: BRAND_ID,
          normalizedKeyword,
          language: "en",
          country: "US",
        },
      },
      create: {
        brandId: BRAND_ID,
        keyword: keyword.trim(),
        normalizedKeyword,
        language: "en",
        country: "US",
        source,
        relevance,
        topic: topic ?? null,
        active: true,
      },
      update: {
        // Only upgrade relevance, never downgrade
        relevance: { set: undefined },
        topic: topic ?? undefined,
      },
    });
  }

  async seedFromBrand(): Promise<number> {
    const brand = await this.prisma.brand.findUnique({
      where: { id: BRAND_ID },
      include: {
        facts: true,
        guidelines: true,
      },
    });
    if (!brand) return 0;

    const candidates = new Set<string>();

    const extractPhrases = (text: string) => {
      const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s\-']/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

      // Single meaningful words
      words.forEach((w) => {
        if (w.length >= 4) candidates.add(w);
      });

      // 2-word phrases
      for (let i = 0; i < words.length - 1; i++) {
        const phrase = `${words[i]} ${words[i + 1]}`;
        if (!STOP_WORDS.has(words[i]) && !STOP_WORDS.has(words[i + 1])) {
          candidates.add(phrase);
        }
      }

      // 3-word phrases
      for (let i = 0; i < words.length - 2; i++) {
        if (!STOP_WORDS.has(words[i]) && !STOP_WORDS.has(words[i + 2])) {
          candidates.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
        }
      }
    };

    if (brand.name) extractPhrases(brand.name);
    if (brand.description) extractPhrases(brand.description);
    if (brand.audience) extractPhrases(brand.audience);
    brand.facts.forEach((f) => extractPhrases(f.content));

    let count = 0;
    for (const kw of candidates) {
      await this.addKeyword(kw, "BRAND_SEED", 0.6);
      count++;
    }

    this.logger.log(`Seeded ${count} keywords from brand`);
    return count;
  }

  async seedFromProducts(): Promise<number> {
    const products = await this.prisma.product.findMany({
      where: { brandId: BRAND_ID, active: true },
    });

    let count = 0;
    for (const p of products) {
      // Product name → high relevance
      await this.addKeyword(
        p.name,
        "PRODUCT_SEED",
        0.9,
        p.category ?? undefined,
      );
      count++;

      // Category
      if (p.category) {
        await this.addKeyword(p.category, "PRODUCT_SEED", 0.7);
        await this.addKeyword(`${p.category} skincare`, "PRODUCT_SEED", 0.7);
        count++;
      }

      // Tags
      for (const tag of p.tags) {
        await this.addKeyword(tag, "PRODUCT_SEED", 0.7);
        count++;
      }

      // Description phrases
      if (p.description) {
        const words = p.description
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

        for (let i = 0; i < words.length - 1; i++) {
          await this.addKeyword(
            `${words[i]} ${words[i + 1]}`,
            "PRODUCT_SEED",
            0.5,
            p.category ?? undefined,
          );
          count++;
        }
      }

      // Common modifier combinations
      await this.addKeyword(
        `buy ${p.name}`,
        "PRODUCT_SEED",
        0.85,
        p.category ?? undefined,
      );
      await this.addKeyword(
        `${p.name} review`,
        "PRODUCT_SEED",
        0.75,
        p.category ?? undefined,
      );
      count += 2;
    }

    this.logger.log(`Seeded ${count} keywords from products`);
    return count;
  }

  async seedFromSearchConsole(rows: SearchConsoleRow[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      // Higher impressions = higher relevance signal
      const relevance = Math.min(0.9, 0.4 + (row.impressions / 10000) * 0.5);
      await this.addKeyword(row.query, "SEARCH_CONSOLE", relevance);
      count++;
    }
    this.logger.log(`Seeded ${count} keywords from Search Console`);
    return count;
  }

  async seedFromKeywordPlanner(ideas: KeywordIdeaResult[]): Promise<number> {
    let count = 0;
    for (const idea of ideas) {
      const volume = idea.avgMonthlySearches ?? 0;
      const relevance = Math.min(0.9, 0.3 + (volume / 10000) * 0.6);
      await this.addKeyword(idea.keyword, "KEYWORD_PLANNER", relevance);
      count++;
    }
    this.logger.log(`Seeded ${count} keywords from Keyword Planner`);
    return count;
  }

  async listKeywords(filters?: {
    topic?: string;
    intent?: string;
    minRelevance?: number;
    active?: boolean;
  }) {
    return this.prisma.keyword.findMany({
      where: {
        brandId: BRAND_ID,
        active: filters?.active !== undefined ? filters.active : true,
        topic: filters?.topic ?? undefined,
        intent: filters?.intent ?? undefined,
        relevance: filters?.minRelevance
          ? { gte: filters.minRelevance }
          : undefined,
      },
      orderBy: { relevance: "desc" },
      include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
    });
  }

  async getKeywordsForContext() {
    return this.prisma.keyword.findMany({
      where: { brandId: BRAND_ID, active: true },
      orderBy: { relevance: "desc" },
      take: 50,
    });
  }
}
