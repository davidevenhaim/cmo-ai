import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  ObservationInput,
  PerformanceProvider,
  ProviderCollectResult,
} from "../performance-provider.interface";

const BRAND_ID = "luminesce-brand-001";

interface Ga4Row {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

// Read-only GA4 Data API adapter (runReport). Requires GA4_PROPERTY_ID and
// GA4_ACCESS_TOKEN. Without them the provider is honestly NOT_CONFIGURED.
// GA4_USE_MOCK=true produces clearly-marked mock observations that are never
// used for real performance conclusions.
@Injectable()
export class Ga4PerformanceProvider implements PerformanceProvider {
  readonly key = "ga4";
  private readonly logger = new Logger(Ga4PerformanceProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  get status(): "AVAILABLE" | "NOT_CONFIGURED" | "MOCK" {
    if (this.config.get<string>("GA4_USE_MOCK", "") === "true") return "MOCK";
    const propertyId = this.config.get<string>("GA4_PROPERTY_ID", "");
    const token = this.config.get<string>("GA4_ACCESS_TOKEN", "");
    return propertyId && token ? "AVAILABLE" : "NOT_CONFIGURED";
  }

  get missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.config.get<string>("GA4_PROPERTY_ID", ""))
      missing.push("GA4_PROPERTY_ID");
    if (!this.config.get<string>("GA4_ACCESS_TOKEN", ""))
      missing.push("GA4_ACCESS_TOKEN");
    return missing;
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
        observations: this.mockObservations(window),
        detail: "GA4_USE_MOCK=true — mock traffic, excluded from conclusions",
      };
    }
    if (status === "NOT_CONFIGURED") {
      return {
        provider: this.key,
        status: "NOT_CONFIGURED",
        observations: [],
        detail: `Missing: ${this.missingConfig.join(", ")}`,
      };
    }

    try {
      const [daily, campaigns] = await Promise.all([
        this.runReport({
          dateRanges: [
            {
              startDate: isoDate(window.since),
              endDate: isoDate(window.until),
            },
          ],
          dimensions: [{ name: "date" }],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "conversions" },
          ],
        }),
        this.runReport({
          dateRanges: [
            {
              startDate: isoDate(window.since),
              endDate: isoDate(window.until),
            },
          ],
          dimensions: [{ name: "sessionCampaignName" }],
          metrics: [{ name: "sessions" }, { name: "conversions" }],
        }),
      ]);

      const observations: ObservationInput[] = [];
      for (const row of daily) {
        const date = row.dimensionValues?.[0]?.value ?? "";
        const bucketStart = ga4DateToUtc(date);
        if (!bucketStart) continue;
        const bucketEnd = new Date(bucketStart.getTime() + 86_400_000);
        const [sessions, users, conversions] = (row.metricValues ?? []).map(
          (v) => Number(v.value ?? 0),
        );
        observations.push(
          this.brandObservation(
            "sessions",
            "TRAFFIC",
            sessions ?? 0,
            bucketStart,
            bucketEnd,
          ),
          this.brandObservation(
            "users",
            "REACH",
            users ?? 0,
            bucketStart,
            bucketEnd,
          ),
          this.brandObservation(
            "conversions",
            "CONVERSIONS",
            conversions ?? 0,
            bucketStart,
            bucketEnd,
          ),
        );
      }

      const bucketStart = startOfDayUtc(window.since);
      for (const row of campaigns) {
        const campaign = row.dimensionValues?.[0]?.value ?? "";
        // Only deterministic CMO campaigns — everything else stays brand-level.
        if (!campaign.startsWith("cmo-")) continue;
        const [sessions, conversions] = (row.metricValues ?? []).map((v) =>
          Number(v.value ?? 0),
        );
        observations.push(
          {
            provider: this.key,
            subjectType: "CAMPAIGN",
            subjectId: campaign,
            metric: "sessions",
            dimension: "TRAFFIC",
            value: sessions ?? 0,
            unit: "COUNT",
            bucketStart,
            bucketEnd: window.until,
            attributionStrength: "ATTRIBUTED",
            dataQuality: "COMPLETE",
          },
          {
            provider: this.key,
            subjectType: "CAMPAIGN",
            subjectId: campaign,
            metric: "conversions",
            dimension: "CONVERSIONS",
            value: conversions ?? 0,
            unit: "COUNT",
            bucketStart,
            bucketEnd: window.until,
            attributionStrength: "ATTRIBUTED",
            dataQuality: "COMPLETE",
          },
        );
      }

      return {
        provider: this.key,
        status: "AVAILABLE",
        observations,
        detail: null,
      };
    } catch (err: any) {
      this.logger.warn(`GA4 collect failed: ${err.message}`);
      return {
        provider: this.key,
        status: "ERROR",
        observations: [],
        detail: err.message,
      };
    }
  }

  private brandObservation(
    metric: string,
    dimension: ObservationInput["dimension"],
    value: number,
    bucketStart: Date,
    bucketEnd: Date,
  ): ObservationInput {
    return {
      provider: this.key,
      subjectType: "BRAND",
      subjectId: BRAND_ID,
      metric,
      dimension,
      value,
      unit: "COUNT",
      bucketStart,
      bucketEnd,
      attributionStrength: "DIRECT",
      dataQuality: "COMPLETE",
    };
  }

  private async runReport(body: Record<string, unknown>): Promise<Ga4Row[]> {
    const propertyId = this.config.get<string>("GA4_PROPERTY_ID", "");
    const token = this.config.get<string>("GA4_ACCESS_TOKEN", "");
    const response = await firstValueFrom(
      this.http.post(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
        body,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15_000,
        },
      ),
    );
    return (response.data?.rows ?? []) as Ga4Row[];
  }

  private mockObservations(window: {
    since: Date;
    until: Date;
  }): ObservationInput[] {
    const bucketStart = startOfDayUtc(window.since);
    return [
      {
        provider: this.key,
        subjectType: "BRAND",
        subjectId: BRAND_ID,
        metric: "sessions",
        dimension: "TRAFFIC",
        value: 0,
        unit: "COUNT",
        bucketStart,
        bucketEnd: window.until,
        isMock: true,
        dataQuality: "UNAVAILABLE",
        attributionStrength: "UNKNOWN",
      },
    ];
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ga4DateToUtc(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return new Date(
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00.000Z`,
  );
}

function startOfDayUtc(d: Date): Date {
  const day = new Date(d);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}
