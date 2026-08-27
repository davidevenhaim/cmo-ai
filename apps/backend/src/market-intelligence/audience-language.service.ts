import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

// Minimum frequency before a phrase is worth storing
const MIN_PHRASE_FREQUENCY = 2;
const MAX_EXCERPT_LENGTH = 200;
const MAX_EXCERPTS_PER_SIGNAL = 3;

// Brand-relevant vocabulary — phrases containing these words may be relevant
const RELEVANCE_VOCAB = [
  "skin",
  "face",
  "tallow",
  "balm",
  "cream",
  "moisturizer",
  "moisturize",
  "moisturising",
  "dry",
  "oily",
  "sensitive",
  "natural",
  "organic",
  "ingredient",
  "formula",
  "lotion",
  "serum",
  "oil",
  "butter",
  "rash",
  "acne",
  "pore",
  "hydrate",
  "hydration",
  "collagen",
  "wrinkle",
  "age",
  "repair",
  "barrier",
  "cleanse",
  "cleanser",
  "treatment",
  "routine",
];

function isRelevant(phrase: string): boolean {
  const lower = phrase.toLowerCase();
  return RELEVANCE_VOCAB.some((v) => lower.includes(v));
}

function extractPhrases(text: string): string[] {
  const sentences = text
    .replace(/[.!?]/g, ".|")
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const phrases: string[] = [];
  for (const sentence of sentences) {
    const words = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s\-']/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    // 2–5 word phrases
    for (let len = 2; len <= 5; len++) {
      for (let i = 0; i <= words.length - len; i++) {
        phrases.push(words.slice(i, i + len).join(" "));
      }
    }
  }
  return phrases;
}

function extractQuestions(text: string): string[] {
  const sentences = text
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.filter((s) => {
    const lower = s.toLowerCase();
    return (
      s.endsWith("?") ||
      /^(how|what|why|does|can|will|is|are|should)\b/.test(lower)
    );
  });
}

@Injectable()
export class AudienceLanguageService {
  private readonly logger = new Logger(AudienceLanguageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestFromFindings(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const findings = await this.prisma.researchFinding.findMany({
      where: {
        brandId: BRAND_ID,
        discoveredAt: { gte: cutoff },
        sourceType: { in: ["SUBREDDIT", "FORUM", "BLOG", "WEBSITE"] },
      },
      select: { excerpt: true, sourceType: true, topic: true },
      take: 500,
    });

    // Frequency map: phrase → { count, sourceTypes, excerpts }
    const phraseMap = new Map<
      string,
      {
        count: number;
        sourceTypes: Set<string>;
        excerpts: string[];
        topic?: string;
      }
    >();

    for (const finding of findings) {
      const phrases = extractPhrases(finding.excerpt);
      for (const phrase of phrases) {
        if (!isRelevant(phrase)) continue;
        const entry = phraseMap.get(phrase) ?? {
          count: 0,
          sourceTypes: new Set<string>(),
          excerpts: [],
          topic: finding.topic ?? undefined,
        };
        entry.count++;
        entry.sourceTypes.add(finding.sourceType);
        if (entry.excerpts.length < MAX_EXCERPTS_PER_SIGNAL) {
          const excerpt = finding.excerpt.slice(0, MAX_EXCERPT_LENGTH);
          if (!entry.excerpts.includes(excerpt)) entry.excerpts.push(excerpt);
        }
        phraseMap.set(phrase, entry);
      }
    }

    let upserted = 0;
    for (const [phrase, data] of phraseMap.entries()) {
      if (data.count < MIN_PHRASE_FREQUENCY) continue;
      await this.prisma.audienceLanguageSignal.upsert({
        where: { brandId_phrase: { brandId: BRAND_ID, phrase } },
        create: {
          brandId: BRAND_ID,
          phrase,
          topic: data.topic ?? null,
          frequency: data.count,
          sourceTypes: Array.from(data.sourceTypes),
          excerpts: data.excerpts,
          confidence: Math.min(0.9, 0.3 + (data.count / 10) * 0.6),
        },
        update: {
          frequency: data.count,
          sourceTypes: Array.from(data.sourceTypes),
          excerpts: data.excerpts,
          confidence: Math.min(0.9, 0.3 + (data.count / 10) * 0.6),
          updatedAt: new Date(),
        },
      });
      upserted++;
    }

    this.logger.log(`Upserted ${upserted} audience language signals`);
    return upserted;
  }

  async ingestQuestions(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const findings = await this.prisma.researchFinding.findMany({
      where: {
        brandId: BRAND_ID,
        discoveredAt: { gte: cutoff },
      },
      select: { excerpt: true, sourceType: true, topic: true },
      take: 500,
    });

    const questionMap = new Map<
      string,
      { count: number; sources: Set<string>; topic?: string }
    >();

    for (const finding of findings) {
      const questions = extractQuestions(finding.excerpt);
      for (const q of questions) {
        if (!isRelevant(q) || q.length < 10 || q.length > 150) continue;
        const normalized = q.toLowerCase().trim();
        const entry = questionMap.get(normalized) ?? {
          count: 0,
          sources: new Set<string>(),
          topic: finding.topic ?? undefined,
        };
        entry.count++;
        entry.sources.add(finding.sourceType);
        questionMap.set(normalized, entry);
      }
    }

    let upserted = 0;
    for (const [question, data] of questionMap.entries()) {
      await this.prisma.questionSignal.upsert({
        where: { brandId_question: { brandId: BRAND_ID, question } },
        create: {
          brandId: BRAND_ID,
          question,
          topic: data.topic ?? null,
          frequency: data.count,
          sources: Array.from(data.sources),
        },
        update: {
          frequency: data.count,
          sources: Array.from(data.sources),
          updatedAt: new Date(),
        },
      });
      upserted++;
    }

    this.logger.log(`Upserted ${upserted} question signals`);
    return upserted;
  }

  async getTopSignals(limit = 20) {
    return this.prisma.audienceLanguageSignal.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { frequency: "desc" },
      take: limit,
    });
  }

  async getQuestions(limit = 20) {
    return this.prisma.questionSignal.findMany({
      where: { brandId: BRAND_ID },
      orderBy: { frequency: "desc" },
      take: limit,
    });
  }
}
