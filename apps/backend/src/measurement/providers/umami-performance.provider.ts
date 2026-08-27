import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  ObservationInput,
  PerformanceProvider,
  ProviderCollectResult,
} from "../performance-provider.interface";

/**
 * Umami self-hosted analytics → PerformanceObservation.
 * MOCK never claimed as real. GA4 remains optional cloud.
 */
@Injectable()
export class UmamiPerformanceProvider implements PerformanceProvider {
  readonly key = "umami";
  private readonly logger = new Logger(UmamiPerformanceProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  private get baseUrl(): string {
    return (this.config.get<string>("UMAMI_BASE_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  private get websiteId(): string {
    return (this.config.get<string>("UMAMI_WEBSITE_ID") ?? "").trim();
  }

  private get apiToken(): string {
    return (this.config.get<string>("UMAMI_API_TOKEN") ?? "").trim();
  }

  get status(): "AVAILABLE" | "NOT_CONFIGURED" | "MOCK" {
    if (this.config.get<string>("UMAMI_USE_MOCK", "") === "true") return "MOCK";
    return this.baseUrl && this.websiteId && this.apiToken
      ? "AVAILABLE"
      : "NOT_CONFIGURED";
  }

  async collect(window: {
    since: Date;
    until: Date;
  }): Promise<ProviderCollectResult> {
    const status = this.status;
    if (status === "MOCK") {
      return {
        provider: this.key,
        status: "MOCK",
        observations: [
          {
            provider: this.key,
            subjectType: "BRAND",
            subjectId: "luminesce-brand-001",
            metric: "sessions",
            dimension: "TRAFFIC",
            value: 42,
            unit: "COUNT",
            bucketStart: window.since,
            bucketEnd: window.until,
            isMock: true,
            dataQuality: "INSUFFICIENT",
          },
        ],
        detail: "UMAMI_USE_MOCK=true — excluded from real conclusions",
      };
    }
    if (status === "NOT_CONFIGURED") {
      return {
        provider: this.key,
        status: "NOT_CONFIGURED",
        observations: [],
        detail: "Missing UMAMI_BASE_URL / UMAMI_WEBSITE_ID / UMAMI_API_TOKEN",
      };
    }

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/api/websites/${this.websiteId}/stats`, {
          params: {
            startAt: window.since.getTime(),
            endAt: window.until.getTime(),
          },
          timeout: 10000,
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        }),
      );

      const stats = response.data ?? {};
      const observations: ObservationInput[] = [];
      const map: Array<[string, number | undefined]> = [
        ["sessions", num(stats.visits ?? stats.pageviews)],
        ["visitors", num(stats.visitors ?? stats.uniques)],
        ["pageviews", num(stats.pageviews)],
        ["bounces", num(stats.bounces)],
      ];

      for (const [metric, value] of map) {
        if (value === undefined) continue;
        observations.push({
          provider: this.key,
          subjectType: "BRAND",
          subjectId: "luminesce-brand-001",
          metric,
          dimension: "TRAFFIC",
          value,
          unit: "COUNT",
          bucketStart: window.since,
          bucketEnd: window.until,
          isMock: false,
          dataQuality: "COMPLETE",
          attributionStrength: "CORRELATED",
          rawPayload: { metric },
        });
      }

      return {
        provider: this.key,
        status: "AVAILABLE",
        observations,
        detail: `Umami stats for ${this.websiteId}`,
      };
    } catch (err: any) {
      this.logger.warn(`Umami collect failed: ${err.message}`);
      return {
        provider: this.key,
        status: "ERROR",
        observations: [],
        detail: err.message,
      };
    }
  }
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "object" && v !== null && "value" in (v as any)) {
    const n = Number((v as any).value);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
