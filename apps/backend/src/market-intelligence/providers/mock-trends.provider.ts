import { Injectable } from "@nestjs/common";
import type {
  TrendsProvider,
  TrendResult,
  TrendDataPoint,
} from "./trends.provider";

const NOTE = "Values are relative (0–100), not absolute search volume";

function buildMonthlyPoints(
  values: number[],
  monthsBack: number,
): TrendDataPoint[] {
  const now = new Date();
  const points: TrendDataPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    points.push({ period, value: values[monthsBack - 1 - i] ?? 50 });
  }
  return points;
}

const FIXTURES: Record<
  string,
  Pick<
    TrendResult,
    | "isRising"
    | "isBreakout"
    | "relatedTopics"
    | "relatedQueries"
    | "recentDelta"
  > & { values: number[] }
> = {
  "tallow moisturizer": {
    isRising: true,
    isBreakout: true,
    recentDelta: 28,
    values: [12, 15, 18, 22, 25, 30, 38, 45, 58, 70, 88, 100],
    relatedTopics: [
      "grass-fed beef tallow",
      "ancestral skincare",
      "beef tallow",
    ],
    relatedQueries: [
      "tallow face cream",
      "tallow balm recipe",
      "beef tallow for skin",
      "tallow moisturizer benefits",
    ],
  },
  "natural skincare": {
    isRising: false,
    isBreakout: false,
    recentDelta: 2,
    values: [62, 65, 60, 68, 64, 70, 66, 71, 68, 72, 69, 71],
    relatedTopics: ["clean beauty", "organic skincare", "non-toxic skincare"],
    relatedQueries: [
      "natural skincare routine",
      "best natural face moisturizer",
      "natural skincare brands",
    ],
  },
  "petroleum jelly": {
    isRising: false,
    isBreakout: false,
    recentDelta: -15,
    values: [80, 78, 75, 72, 70, 68, 65, 62, 58, 54, 50, 46],
    relatedTopics: ["vaseline", "mineral oil", "petroleum products"],
    relatedQueries: [
      "petroleum jelly uses",
      "is petroleum jelly safe",
      "petroleum jelly alternatives",
    ],
  },
};

const DEFAULT_FIXTURE: (typeof FIXTURES)[string] = {
  isRising: false,
  isBreakout: false,
  recentDelta: 0,
  values: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  relatedTopics: [],
  relatedQueries: [],
};

@Injectable()
export class MockTrendsProvider implements TrendsProvider {
  readonly providerName = "mock-trends";

  isConfigured(): boolean {
    return false;
  }

  async getTrend(
    keyword: string,
    geo = "US",
    months = 12,
  ): Promise<TrendResult> {
    const fixture = FIXTURES[keyword.toLowerCase()] ?? DEFAULT_FIXTURE;
    const data = buildMonthlyPoints(fixture.values, months);
    const values = data.map((d) => d.value);
    const averageValue = values.reduce((a, b) => a + b, 0) / values.length;
    const peakValue = Math.max(...values);

    return {
      keyword,
      timeframe: `today ${months}-m`,
      data,
      isRising: fixture.isRising,
      isBreakout: fixture.isBreakout,
      averageValue: Math.round(averageValue * 10) / 10,
      peakValue,
      recentDelta: fixture.recentDelta,
      relatedTopics: fixture.relatedTopics,
      relatedQueries: fixture.relatedQueries,
      geo,
      evidenceStatus: "MOCK",
      note: NOTE,
    };
  }

  async getRelatedQueries(keyword: string, _geo = "US"): Promise<string[]> {
    const fixture = FIXTURES[keyword.toLowerCase()] ?? DEFAULT_FIXTURE;
    return fixture.relatedQueries;
  }
}
