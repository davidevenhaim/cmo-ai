import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MEASUREMENT_POLICY } from "./measurement-policy.config";

const BRAND_ID = "luminesce-brand-001";

export interface BaselineResult {
  baseline: number | null;
  samples: number;
  windowDays: number;
}

// Rolling like-with-like baselines. A channel's new item is compared with
// prior items on the SAME channel and metric — an Instagram post against
// previous Instagram posts, a blog article against previous blog articles.
// Arbitrary incompatible metrics are never mixed.
@Injectable()
export class BaselineService {
  constructor(private readonly prisma: PrismaService) {}

  // Average per-publication total for `metric` across prior publications on
  // the same channel, observed before `before`, within `windowDays`.
  async channelContentBaseline(input: {
    channel: string;
    metric: string;
    before: Date;
    windowDays?: number;
    excludeSubjectIds?: string[];
  }): Promise<BaselineResult> {
    const windowDays = input.windowDays ?? 30;
    const since = new Date(
      input.before.getTime() - windowDays * 24 * 60 * 60 * 1000,
    );

    // Prior publications on the same channel (like-with-like).
    const priorRequests = await this.prisma.publishRequest.findMany({
      where: {
        brandId: BRAND_ID,
        provider: input.channel,
        status: "SUCCEEDED",
      },
      include: { publication: { select: { id: true, publishedAt: true } } },
      orderBy: { executedAt: "desc" },
      take: 50,
    });

    const publicationIds = priorRequests
      .filter(
        (r) =>
          r.publication &&
          r.publication.publishedAt &&
          r.publication.publishedAt < input.before &&
          r.publication.publishedAt >= since,
      )
      .map((r) => r.publication!.id)
      .filter((id) => !(input.excludeSubjectIds ?? []).includes(id));

    if (publicationIds.length === 0) {
      return { baseline: null, samples: 0, windowDays };
    }

    const observations = await this.prisma.performanceObservation.findMany({
      where: {
        brandId: BRAND_ID,
        subjectType: "PUBLICATION",
        subjectId: { in: publicationIds },
        metric: input.metric,
        isMock: false,
      },
    });

    const totals = new Map<string, number>();
    for (const obs of observations) {
      totals.set(obs.subjectId, (totals.get(obs.subjectId) ?? 0) + obs.value);
    }

    const samples = totals.size;
    if (samples === 0) return { baseline: null, samples: 0, windowDays };

    const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    return { baseline: sum / samples, samples, windowDays };
  }

  // Average daily brand-level value for `metric` over a rolling window.
  async brandDailyBaseline(input: {
    provider: string;
    metric: string;
    before: Date;
    windowDays?: number;
  }): Promise<BaselineResult> {
    const windowDays = input.windowDays ?? 30;
    const since = new Date(
      input.before.getTime() - windowDays * 24 * 60 * 60 * 1000,
    );

    const observations = await this.prisma.performanceObservation.findMany({
      where: {
        brandId: BRAND_ID,
        provider: input.provider,
        subjectType: "BRAND",
        metric: input.metric,
        isMock: false,
        bucketStart: { gte: since, lt: input.before },
      },
    });

    if (observations.length === 0) {
      return { baseline: null, samples: 0, windowDays };
    }
    const sum = observations.reduce((a, o) => a + o.value, 0);
    return {
      baseline: sum / observations.length,
      samples: observations.length,
      windowDays,
    };
  }

  usable(result: BaselineResult): boolean {
    return (
      result.baseline !== null &&
      result.samples >= MEASUREMENT_POLICY.minBaselineSamples
    );
  }
}
