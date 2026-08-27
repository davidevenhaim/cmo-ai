import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import type { SearchResult } from "./providers/search.provider";
import type { ExtractResult } from "./providers/crawl.provider";

export interface NormalizedFinding {
  url: string;
  urlHash: string;
  title: string;
  excerpt: string; // max 500 chars, sanitized
  sourceType: string;
  topic: string | null;
  publishedAt: Date | null;
  providerMeta: Record<string, unknown>;
}

// Tracking params to strip from URLs before hashing
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "ref",
  "source",
  "mc_cid",
  "mc_eid",
];

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const param of TRACKING_PARAMS) {
      u.searchParams.delete(param);
    }
    u.hash = "";
    return u.toString().toLowerCase().replace(/\/$/, "");
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex");
}

// Strip any text that looks like injected instructions
export function sanitizeContent(text: string): string {
  // Remove patterns that attempt to override system instructions
  return text
    .replace(
      /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)\b/gi,
      "[content removed]",
    )
    .replace(
      /\b(you\s+are\s+now|act\s+as|pretend\s+(you\s+are|to\s+be))\b/gi,
      "[content removed]",
    )
    .replace(/\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>/g, "")
    .slice(0, 500);
}

@Injectable()
export class ResearchNormalizerService {
  fromSearchResult(result: SearchResult, intent?: string): NormalizedFinding {
    const excerpt = sanitizeContent(result.snippet || result.title);
    return {
      url: result.url,
      urlHash: hashUrl(result.url),
      title: result.title.slice(0, 200),
      excerpt,
      sourceType: result.sourceType ?? "GENERIC",
      topic: intentToTopic(intent),
      publishedAt: result.publishedAt ?? null,
      providerMeta: (result.metadata as Record<string, unknown>) ?? {},
    };
  }

  fromExtractResult(
    result: ExtractResult,
    sourceType: string,
  ): NormalizedFinding {
    const excerpt = sanitizeContent(result.content);
    return {
      url: result.url,
      urlHash: hashUrl(result.url),
      title: result.title.slice(0, 200),
      excerpt,
      sourceType,
      topic: null,
      publishedAt: result.metadata?.publishedAt ?? null,
      providerMeta: {
        author: result.metadata?.author,
        description: result.metadata?.description,
      },
    };
  }
}

function intentToTopic(intent?: string): string | null {
  const map: Record<string, string> = {
    TREND: "trend",
    CUSTOMER_QUESTION: "customer question",
    PRODUCT_INSIGHT: "product insight",
    COMPETITOR_ACTIVITY: "competitor activity",
    ENGAGEMENT: "community engagement",
  };
  return intent ? (map[intent] ?? null) : null;
}
