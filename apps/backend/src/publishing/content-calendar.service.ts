import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

export type CalendarItemStatus =
  "DRAFT" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "FAILED" | "UNKNOWN";

export interface CalendarItem {
  id: string;
  type: "content_draft" | "publish_request";
  title: string;
  channel: string;
  provider?: string;
  status: CalendarItemStatus;
  scheduledAt?: Date;
  publishedAt?: Date;
  remoteUrl?: string;
  contentDraftId?: string;
  publishRequestId?: string;
  createdAt: Date;
}

@Injectable()
export class ContentCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // Chronological list combining ContentDrafts and PublishRequests.
  async list(filters?: {
    status?: CalendarItemStatus;
    provider?: string;
  }): Promise<CalendarItem[]> {
    const [drafts, requests] = await Promise.all([
      this.prisma.contentDraft.findMany({
        where: { brandId: BRAND_ID },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { brief: { select: { topic: true, channel: true } } },
      }),
      this.prisma.publishRequest.findMany({
        where: { brandId: BRAND_ID },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          publication: true,
          contentDraft: {
            select: { channel: true, headline: true, caption: true },
          },
        },
      }),
    ]);

    const items: CalendarItem[] = [];

    for (const d of drafts) {
      const status = this.mapDraftStatus(d.status);
      if (filters?.status && status !== filters.status) continue;
      items.push({
        id: d.id,
        type: "content_draft",
        title:
          d.headline ??
          d.caption ??
          d.brief?.topic ??
          `${d.channel} ${d.format}`,
        channel: d.channel,
        status,
        contentDraftId: d.id,
        createdAt: d.createdAt,
      });
    }

    for (const r of requests) {
      if (filters?.provider && r.provider !== filters.provider) continue;
      const status = this.mapRequestStatus(r.status, r.publication?.status);
      if (filters?.status && status !== filters.status) continue;
      items.push({
        id: r.id,
        type: "publish_request",
        title:
          r.contentDraft?.headline ??
          r.contentDraft?.caption ??
          `${r.provider} → ${r.destination}`,
        channel: r.contentDraft?.channel ?? r.provider.toUpperCase(),
        provider: r.provider,
        status,
        scheduledAt: r.scheduledAt ?? undefined,
        publishedAt: r.publication?.publishedAt ?? undefined,
        remoteUrl: r.publication?.remoteUrl ?? undefined,
        contentDraftId: r.contentDraftId,
        publishRequestId: r.id,
        createdAt: r.createdAt,
      });
    }

    // Sort: scheduled first by scheduledAt, then published by publishedAt, then by createdAt desc
    return items.sort((a, b) => {
      const aTime = a.scheduledAt ?? a.publishedAt ?? a.createdAt;
      const bTime = b.scheduledAt ?? b.publishedAt ?? b.createdAt;
      return bTime.getTime() - aTime.getTime();
    });
  }

  async getWeek(weekStart: Date): Promise<CalendarItem[]> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const all = await this.list();
    return all.filter((item) => {
      const t = item.scheduledAt ?? item.publishedAt ?? item.createdAt;
      return t >= weekStart && t < weekEnd;
    });
  }

  private mapDraftStatus(s: string): CalendarItemStatus {
    switch (s) {
      case "APPROVED":
        return "APPROVED";
      case "GENERATED":
      case "PENDING_REVIEW":
        return "DRAFT";
      default:
        return "DRAFT";
    }
  }

  private mapRequestStatus(
    reqStatus: string,
    pubStatus?: string | null,
  ): CalendarItemStatus {
    if (reqStatus === "SUCCEEDED") {
      return pubStatus === "LIVE" ? "PUBLISHED" : "SCHEDULED";
    }
    if (reqStatus === "FAILED") return "FAILED";
    if (reqStatus === "UNKNOWN") return "UNKNOWN";
    if (reqStatus === "APPROVED" || reqStatus === "EXECUTING")
      return "SCHEDULED";
    return "DRAFT";
  }
}
