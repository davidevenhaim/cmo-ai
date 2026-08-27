import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma.service";
import { ResearchNormalizerService } from "./research-normalizer.service";

const BRAND_ID = "luminesce-brand-001";

/**
 * Ingests changedetection.io webhooks as research findings.
 * A detected change creates an ingestion event only — never auto-publishes.
 */
@Injectable()
export class ChangedetectionIngestService {
  private readonly logger = new Logger(ChangedetectionIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly normalizer: ResearchNormalizerService,
  ) {}

  assertAuthorized(token: string | undefined): void {
    const expected = (
      this.config.get<string>("CHANGEDETECTION_WEBHOOK_TOKEN") ?? ""
    ).trim();
    if (!expected) {
      throw new UnauthorizedException(
        "CHANGEDETECTION_WEBHOOK_TOKEN not configured",
      );
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException("Invalid changedetection webhook token");
    }
  }

  async ingest(payload: unknown): Promise<{
    findingId: string | null;
    created: boolean;
    url: string | null;
  }> {
    const body = (payload ?? {}) as Record<string, unknown>;
    const url = String(body.watch_url ?? body.url ?? body.link ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      this.logger.warn("Changedetection payload missing http(s) url");
      return { findingId: null, created: false, url: null };
    }

    const title = String(
      body.title ?? body.watch_title ?? `Change detected: ${url}`,
    ).slice(0, 300);
    const excerpt = String(
      body.diff_text ??
        body.message ??
        body.current_snapshot ??
        "Site change detected by changedetection.io",
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);

    const detectedAtRaw = body.timestamp ?? body.changedetected ?? null;
    const detectedAt = detectedAtRaw
      ? new Date(String(detectedAtRaw))
      : new Date();

    const run = await this.prisma.researchRun.create({
      data: {
        brandId: BRAND_ID,
        status: "COMPLETED",
        triggeredBy: "CHANGEDETECTION",
        startedAt: detectedAt,
        completedAt: new Date(),
        resultCount: 1,
        findingsCreated: 0,
        queries: [],
        providers: ["changedetection"],
      },
    });

    const normalized = this.normalizer.fromSearchResult(
      {
        url,
        title,
        snippet: excerpt,
        sourceType: "COMPETITOR",
        publishedAt: detectedAt,
        metadata: {
          provider: "changedetection",
          watchUuid: body.uuid ?? body.watch_uuid ?? null,
          untrusted: true,
        },
      },
      "COMPETITOR_CHANGE",
    );

    // Light scoring without full brand signals — relevance default for watched URLs.
    const scored = {
      ...normalized,
      relevanceScore: 0.7,
      urgencyScore: 0.8,
    };

    const existing = await this.prisma.researchFinding.findUnique({
      where: { urlHash: scored.urlHash },
    });

    if (existing) {
      await this.prisma.researchFinding.update({
        where: { id: existing.id },
        data: {
          title: scored.title,
          excerpt: scored.excerpt,
          discoveredAt: detectedAt,
          urgencyScore: Math.max(existing.urgencyScore, scored.urgencyScore),
          providerMeta: {
            ...(typeof existing.providerMeta === "object" &&
            existing.providerMeta
              ? (existing.providerMeta as object)
              : {}),
            lastChangeAt: detectedAt.toISOString(),
            source: "changedetection",
            runId: run.id,
          } as any,
        },
      });
      this.logger.log(
        `Changedetection updated finding ${existing.id} for ${url}`,
      );
      return { findingId: existing.id, created: false, url };
    }

    const finding = await this.prisma.researchFinding.create({
      data: {
        brandId: BRAND_ID,
        runId: run.id,
        url: scored.url,
        urlHash: scored.urlHash,
        title: scored.title,
        excerpt: scored.excerpt,
        sourceType: scored.sourceType,
        topic: scored.topic ?? "competitor change",
        relevanceScore: scored.relevanceScore,
        urgencyScore: scored.urgencyScore,
        publishedAt: detectedAt,
        providerMeta: {
          source: "changedetection",
          untrusted: true,
          detectedAt: detectedAt.toISOString(),
          watchUuid: body.uuid ?? body.watch_uuid ?? null,
        } as any,
      },
    });

    this.logger.log(`Changedetection created finding ${finding.id} for ${url}`);
    return { findingId: finding.id, created: true, url };
  }
}

/** Stable hash helper exported for tests. */
export function hashUrl(url: string): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(url).digest("hex");
}
