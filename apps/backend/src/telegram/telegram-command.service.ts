import { Injectable, Logger } from "@nestjs/common";
import type { WeeklyReview } from "@ai-cmo/contracts";
import { CmoService } from "../cmo/cmo.service";
import { BrandService } from "../brand/brand.service";
import { ApprovalService } from "../approval/approval.service";
import { TelegramService } from "./telegram.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ResearchService } from "../research/research.service";
import { OpportunityService } from "../research/opportunity.service";
import { ContentService } from "../content/content.service";
import { ContentGenerationService } from "../content/content-generation.service";
import { GrowthContextService } from "../growth/growth-context.service";
import { AbandonedCheckoutService } from "../growth/abandoned-checkout.service";
import { SegmentService } from "../growth/segment.service";
import { CampaignService } from "../growth/campaign.service";
import { WordPressAdapter } from "../wordpress/wordpress.adapter";
import { PublishingService } from "../publishing/publishing.service";
import { MarketIntelligenceSyncService } from "../market-intelligence/market-intelligence-sync.service";
import { MarketIntelligenceContextService } from "../market-intelligence/market-intelligence-context.service";
import { RevenueContextService } from "../revenue-optimization/revenue-context.service";
import { WeeklyReviewService } from "../measurement/weekly-review.service";

@Injectable()
export class TelegramCommandService {
  private readonly logger = new Logger(TelegramCommandService.name);

  constructor(
    private readonly cmoService: CmoService,
    private readonly brandService: BrandService,
    private readonly approvalService: ApprovalService,
    private readonly telegramService: TelegramService,
    private readonly shopifyService: ShopifyService,
    private readonly researchService: ResearchService,
    private readonly opportunityService: OpportunityService,
    private readonly contentService: ContentService,
    private readonly contentGenerationService: ContentGenerationService,
    private readonly growthContextService: GrowthContextService,
    private readonly abandonedCheckoutService: AbandonedCheckoutService,
    private readonly segmentService: SegmentService,
    private readonly campaignService: CampaignService,
    private readonly wordPressAdapter: WordPressAdapter,
    private readonly publishingService: PublishingService,
    private readonly marketSync: MarketIntelligenceSyncService,
    private readonly marketContext: MarketIntelligenceContextService,
    private readonly revenueContext: RevenueContextService,
    private readonly weeklyReview: WeeklyReviewService,
  ) {}

  async handleWeekly(chatId: string): Promise<void> {
    await this.telegramService.sendMessage(
      chatId,
      "📊 Building weekly review...",
    );
    try {
      const review = await this.weeklyReview.generate();
      await this.telegramService.sendMessage(chatId, formatWeekly(review));
    } catch (err: any) {
      this.logger.warn(`Weekly review failed: ${err.message}`);
      await this.telegramService.sendMessage(
        chatId,
        `❌ <b>Weekly review failed</b>\n\n${err.message}`,
      );
    }
  }

  async handleToday(chatId: string): Promise<void> {
    await this.telegramService.sendMessage(
      chatId,
      "🔄 Running CMO analysis...",
    );
    const { run, approval } = await this.cmoService.triggerRun("telegram");
    if (run.failed) {
      await this.telegramService.sendMessage(
        chatId,
        `❌ <b>CMO run failed</b>\n\n${run.failureReason ?? "Unknown error"}`,
      );
      return;
    }
    if (approval) {
      await this.sendApprovalRequest(chatId, approval);
    } else {
      await this.telegramService.sendMessage(chatId, formatDecision(run));
    }
  }

  async handleStatus(chatId: string): Promise<void> {
    let brand: any;
    try {
      brand = await this.brandService.getFullProfile();
    } catch {
      await this.telegramService.sendMessage(
        chatId,
        "⚠️ Could not load brand profile.",
      );
      return;
    }

    const runs = await this.cmoService.listRuns();
    const pending = await this.approvalService.listPending();
    const lastRun = runs[0];

    const lines = [
      `<b>📊 ${brand.name} — Status</b>`,
      "",
      `Facts: ${brand.facts?.length ?? 0}`,
      `Guidelines: ${brand.guidelines?.length ?? 0}`,
      `Products: ${brand.products?.length ?? 0}`,
      "",
      lastRun
        ? `Last run: <b>${lastRun.decisionType}</b> (${Math.round(lastRun.confidence * 100)}% confidence) — ${fmtDate(lastRun.createdAt)}`
        : "No runs yet.",
      "",
      pending.length > 0
        ? `⏳ ${pending.length} pending approval(s)`
        : "✅ No pending approvals",
    ];

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleRuns(chatId: string): Promise<void> {
    const runs = await this.cmoService.listRuns();
    const recent = runs.slice(0, 5);

    if (recent.length === 0) {
      await this.telegramService.sendMessage(
        chatId,
        "No CMO runs yet. Send /today to trigger one.",
      );
      return;
    }

    const lines = ["<b>🕐 Recent CMO Runs</b>", ""];
    for (const run of recent) {
      const status = run.failed
        ? "❌ FAILED"
        : `${Math.round(run.confidence * 100)}%`;
      lines.push(
        `• <b>${run.decisionType}</b> [${status}] — ${fmtDate(run.createdAt)}`,
      );
      lines.push(
        `  ${run.rationale.slice(0, 100)}${run.rationale.length > 100 ? "…" : ""}`,
      );
    }

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleNaturalLanguage(chatId: string, text: string): Promise<void> {
    await this.telegramService.sendMessage(
      chatId,
      "🤔 Running CMO analysis with your context...",
    );
    const { run, approval } = await this.cmoService.triggerRun(
      "telegram",
      text,
    );
    if (run.failed) {
      await this.telegramService.sendMessage(
        chatId,
        `❌ <b>CMO run failed</b>\n\n${run.failureReason ?? "Unknown error"}`,
      );
      return;
    }
    if (approval) {
      await this.sendApprovalRequest(chatId, approval);
    } else {
      await this.telegramService.sendMessage(chatId, formatDecision(run));
    }
  }

  async handleCallbackQuery(
    callbackQueryId: string,
    chatId: string,
    data: string,
  ): Promise<void> {
    const parts = data.split(":");

    if (
      parts[0] === "draft" &&
      parts.length === 3 &&
      parts[2] === "REGENERATE"
    ) {
      const draftId = parts[1];
      await this.telegramService.answerCallbackQuery(
        callbackQueryId,
        "🔄 Regenerating…",
      );
      await this.handleRegenerate(chatId, draftId);
      return;
    }

    if (parts[0] !== "approval" || parts.length !== 3) {
      await this.telegramService.answerCallbackQuery(
        callbackQueryId,
        "Unknown action",
      );
      return;
    }

    const [, approvalId, rawStatus] = parts;
    const status = rawStatus as "APPROVED" | "REJECTED";

    try {
      await this.approvalService.resolve(approvalId, status, "telegram");
      const emoji = status === "APPROVED" ? "✅" : "❌";
      await this.telegramService.answerCallbackQuery(
        callbackQueryId,
        `${emoji} ${status}`,
      );
      if (chatId) {
        await this.telegramService.sendMessage(
          chatId,
          `${emoji} <b>${status}</b> — approval recorded.`,
        );
      }
    } catch (err: any) {
      await this.telegramService.answerCallbackQuery(
        callbackQueryId,
        `Error: ${err.message}`,
      );
    }
  }

  async handleContent(chatId: string): Promise<void> {
    const drafts = await this.contentService.listPendingDrafts();
    if (drafts.length === 0) {
      await this.telegramService.sendMessage(
        chatId,
        "No content drafts pending review.",
      );
      return;
    }
    for (const draft of drafts.slice(0, 3)) {
      await this.sendDraftPreview(chatId, draft);
    }
  }

  async handleDrafts(chatId: string): Promise<void> {
    return this.handleContent(chatId);
  }

  async handleRegenerate(chatId: string, draftId: string): Promise<void> {
    await this.telegramService.sendMessage(chatId, "🔄 Regenerating content…");
    try {
      const draft = await this.contentService.getDraft(draftId);
      const { draft: newDraft, evaluation } =
        await this.contentGenerationService.generateForBrief({
          briefId: draft.briefId,
          revisionFeedback: "Owner requested regeneration.",
        });
      await this.sendDraftPreview(chatId, newDraft, evaluation as any);
    } catch (err: any) {
      await this.telegramService.sendMessage(
        chatId,
        `❌ Regeneration failed: ${err.message}`,
      );
    }
  }

  async sendDraftPreview(
    chatId: string,
    draft: any,
    evaluation?: any,
  ): Promise<void> {
    const content = draft.content as any;
    const score = draft.criticScore ?? evaluation?.overall;
    const scoreLabel =
      score != null ? ` (score: ${(score as number).toFixed(2)})` : "";
    const channel = draft.channel;
    const format = draft.format;

    const preview = buildDraftPreview(content, channel, format);

    const text = [
      `📝 <b>${channel} ${format}</b>${scoreLabel}`,
      `v${draft.version} · ${fmtDate(draft.createdAt)}`,
      "",
      preview,
    ].join("\n");

    const buttons: any[][] = [];
    if (draft.approvalId) {
      buttons.push([
        {
          text: "✅ Approve",
          callback_data: `approval:${draft.approvalId}:APPROVED`,
        },
        {
          text: "❌ Reject",
          callback_data: `approval:${draft.approvalId}:REJECTED`,
        },
      ]);
    }
    buttons.push([
      { text: "🔄 Regenerate", callback_data: `draft:${draft.id}:REGENERATE` },
    ]);

    await this.telegramService.sendMessage(chatId, text, {
      approvalId: draft.approvalId ?? undefined,
      replyMarkup: { inline_keyboard: buttons },
    });
  }

  async handleShopify(chatId: string): Promise<void> {
    const ctx = await this.shopifyService.getCommerceContext();
    if (ctx.evidenceStatus === "UNAVAILABLE") {
      await this.telegramService.sendMessage(
        chatId,
        `⚠️ Shopify unavailable: ${ctx.failureReason ?? "not configured"}`,
      );
      return;
    }
    const staleLabel =
      ctx.evidenceStatus === "STALE"
        ? " ⚠️ <i>(cached — live fetch failed)</i>"
        : "";
    const lines = [
      `🛒 <b>Shopify — ${ctx.shopName ?? "Shop"}</b>${staleLabel}`,
      "",
    ];
    if (ctx.metrics) {
      const m = ctx.metrics;
      const curr = m.currencyCode;
      lines.push(
        `Revenue: <b>${curr} ${m.revenue.toFixed(2)}</b>`,
        `Orders: ${m.orderCount} | AOV: ${curr} ${m.aov.toFixed(2)} | Units: ${m.unitsSold}`,
      );
      if (m.lowInventoryProducts.length > 0) {
        lines.push("", `⚠️ Low stock (${m.lowInventoryProducts.length}):`);
        for (const p of m.lowInventoryProducts.slice(0, 3)) {
          lines.push(`  • ${p.productTitle}: ${p.totalUnits} units`);
        }
      }
    }
    lines.push("", `<i>Fetched ${fmtDate(ctx.fetchedAt)}</i>`);
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleSales(chatId: string): Promise<void> {
    const ctx = await this.shopifyService.getCommerceContext();
    if (ctx.evidenceStatus === "UNAVAILABLE" || !ctx.metrics) {
      await this.telegramService.sendMessage(
        chatId,
        `⚠️ Sales data unavailable: ${ctx.failureReason ?? "not configured"}`,
      );
      return;
    }
    const m = ctx.metrics;
    const curr = m.currencyCode;
    const staleWarning =
      ctx.evidenceStatus === "STALE"
        ? "\n⚠️ <i>Data is cached — live fetch failed. Do not treat as current.</i>"
        : "";
    const incompletWarning = m.metricsIncomplete
      ? "\n⚠️ <i>Metrics may be incomplete (data was truncated).</i>"
      : "";
    const lines = [
      `📊 <b>Sales — ${ctx.shopName ?? "Shop"}</b>${staleWarning}${incompletWarning}`,
      `<i>${fmtDate(m.periodStart)} → ${fmtDate(m.periodEnd)}</i>`,
      "",
      `Revenue: <b>${curr} ${m.revenue.toFixed(2)}</b>`,
      `Orders: ${m.orderCount} | AOV: ${curr} ${m.aov.toFixed(2)} | Units: ${m.unitsSold}`,
    ];
    if (m.previousPeriod?.revenue != null) {
      const change =
        ((m.revenue - m.previousPeriod.revenue) /
          (m.previousPeriod.revenue || 1)) *
        100;
      lines.push(
        `vs prev period: ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
      );
    }
    if (m.revenueByProduct.length > 0) {
      lines.push("", "<b>Top products:</b>");
      for (const p of m.revenueByProduct.slice(0, 5)) {
        lines.push(`  • ${p.productTitle}: ${curr} ${p.revenue.toFixed(2)}`);
      }
    }
    if (m.customerSummary) {
      const cs = m.customerSummary;
      lines.push(
        "",
        `Customers: ${cs.totalCustomers} | Repeat rate: ${(cs.repeatRate * 100).toFixed(0)}%`,
      );
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleResearch(chatId: string): Promise<void> {
    await this.telegramService.sendMessage(
      chatId,
      "🔍 Starting research run... I'll message you when done.",
    );
    // Fire-and-forget: respond immediately, send result when complete
    setImmediate(async () => {
      try {
        const result = await this.researchService.triggerRun("telegram");
        const lines = [
          `✅ <b>Research complete</b>`,
          "",
          `Findings: ${result.findingsCreated} new, ${result.findingsUpdated} updated`,
          `Opportunities: ${result.opportunitiesCreated} created`,
          `Status: ${result.status}`,
        ];
        await this.telegramService.sendMessage(chatId, lines.join("\n"));
      } catch (err: any) {
        await this.telegramService.sendMessage(
          chatId,
          `❌ Research run failed: ${err.message}`,
        );
      }
    });
  }

  async handleOpportunities(chatId: string): Promise<void> {
    const opportunities = await this.opportunityService.list(
      "luminesce-brand-001",
      { status: "NEW", minRelevance: 0.3 },
    );

    if (opportunities.length === 0) {
      await this.telegramService.sendMessage(
        chatId,
        "No new opportunities yet. Send /research to run a research pass.",
      );
      return;
    }

    const lines = [
      `<b>💡 Open Opportunities (${opportunities.length})</b>`,
      "",
    ];
    for (const opp of opportunities.slice(0, 5)) {
      const score = Math.round(opp.relevanceScore * 100);
      const urgency = Math.round(opp.urgencyScore * 100);
      lines.push(
        `• <b>${opp.type}</b> [${score}% rel, ${urgency}% urg]`,
        `  ${opp.title.slice(0, 80)}`,
        `  <i>${opp.reason.slice(0, 100)}</i>`,
        "",
      );
    }

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleGrowth(chatId: string): Promise<void> {
    const ctx = await this.growthContextService.build();

    if (ctx.evidenceStatus === "UNAVAILABLE") {
      await this.telegramService.sendMessage(
        chatId,
        "⚠️ <b>Growth data unavailable</b>\n\nNo sync has completed yet. Trigger a sync from the admin panel.",
      );
      return;
    }

    const staleLabel =
      ctx.evidenceStatus === "STALE" ? " ⚠️ <i>(stale — sync needed)</i>" : "";

    const recovery = ctx.abandonedCheckouts.recoveryRate;
    const recoveryStr =
      recovery != null ? `${Math.round(recovery * 100)}%` : "n/a";
    const lines = [
      `<b>📈 Growth Overview</b>${staleLabel}`,
      "",
      `<b>Abandoned Checkouts</b>`,
      `  Active: ${ctx.abandonedCheckouts.activeCount} (${ctx.abandonedCheckouts.currencyCode} ${ctx.abandonedCheckouts.activeTotalValue.toFixed(2)})`,
      `  Recovery rate: ${recoveryStr}`,
      "",
      `<b>Replenishment</b>`,
    ];
    if (ctx.replenishmentCandidates.length === 0) {
      lines.push("  No configs set");
    } else {
      for (const r of ctx.replenishmentCandidates) {
        lines.push(
          `  ${r.productName}: ${r.candidateCount} candidates (${r.windowDays}d window)`,
        );
      }
    }
    lines.push("", `<b>Lapsed customers</b>: ${ctx.lapsedCustomerCount}`);
    const activeCampaigns = ctx.campaigns["APPROVED"] ?? 0;
    const sentCampaigns = ctx.campaigns["SENT"] ?? 0;
    lines.push(
      `<b>Campaigns</b>: ${activeCampaigns} approved, ${sentCampaigns} sent`,
    );
    lines.push("", "Use /abandoned /segments /campaigns for details.");
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleAbandoned(chatId: string): Promise<void> {
    const checkouts = await this.abandonedCheckoutService.getActive();
    if (checkouts.length === 0) {
      await this.telegramService.sendMessage(
        chatId,
        "No active abandoned checkouts.",
      );
      return;
    }
    const lines = [
      `<b>🛒 Active Abandoned Checkouts (${checkouts.length})</b>`,
      "",
    ];
    for (const c of checkouts.slice(0, 10)) {
      const age = Math.floor(
        (Date.now() - new Date(c.abandonedAt).getTime()) / (1000 * 60 * 60),
      );
      lines.push(
        `• ${c.currencyCode} ${c.totalValue.toFixed(2)} — ${age}h ago`,
        `  Status: ${c.status}`,
      );
    }
    if (checkouts.length > 10) {
      lines.push(`  … and ${checkouts.length - 10} more`);
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleSegments(chatId: string): Promise<void> {
    const segments = await this.segmentService.getSegmentSummary();
    if (segments.length === 0) {
      await this.telegramService.sendMessage(
        chatId,
        "No segments yet. Segments refresh on each CMO run.",
      );
      return;
    }
    const lines = ["<b>👥 Audience Segments</b>", ""];
    for (const s of segments) {
      lines.push(
        `• <b>${s.type}</b>: ${s.memberCount.toLocaleString()} members`,
      );
      if (s.description) lines.push(`  <i>${s.description}</i>`);
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleCampaigns(chatId: string): Promise<void> {
    const campaigns = await this.campaignService.list();
    if (campaigns.length === 0) {
      await this.telegramService.sendMessage(chatId, "No campaigns yet.");
      return;
    }
    const lines = [`<b>📧 Campaigns (${campaigns.length})</b>`, ""];
    for (const c of campaigns.slice(0, 10)) {
      lines.push(`• <b>${c.name}</b> [${c.status}]`, `  Type: ${c.type}`);
    }
    if (campaigns.length > 10) {
      lines.push(`  … and ${campaigns.length - 10} more`);
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleWordPress(chatId: string, text: string): Promise<void> {
    const lower = text.toLowerCase();

    if (
      lower.includes("recent") ||
      lower.includes("posts") ||
      lower === "/wordpress"
    ) {
      const ctx = await this.wordPressAdapter.buildBlogContext();
      if (!ctx.available) {
        await this.telegramService.sendMessage(
          chatId,
          `⚠️ WordPress unavailable: ${ctx.failureReason ?? "not configured"}`,
        );
        return;
      }
      const lines = [
        `📝 <b>WordPress — Recent Posts</b>`,
        `Site: ${ctx.siteUrl}`,
        "",
      ];
      if (ctx.recentPosts.length === 0) {
        lines.push("No posts found.");
      } else {
        for (const p of ctx.recentPosts.slice(0, 8)) {
          const date = new Date(p.publishedAt).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
          lines.push(`• <b>${p.title}</b> [${p.status}] — ${date}`);
          lines.push(`  ${p.url}`);
        }
      }
      await this.telegramService.sendMessage(chatId, lines.join("\n"));
      return;
    }

    if (lower.includes("pending") || lower.includes("request")) {
      const requests = await this.publishingService.listRequests({
        provider: "wordpress",
      });
      if (requests.length === 0) {
        await this.telegramService.sendMessage(
          chatId,
          "No WordPress publish requests.",
        );
        return;
      }
      const lines = [
        `<b>WordPress Publish Requests (${requests.length})</b>`,
        "",
      ];
      for (const r of requests.slice(0, 10)) {
        lines.push(
          `• [${r.status}] Draft: ${r.contentDraftId.slice(0, 8)}… → ${r.destination}`,
          `  ID: <code>${r.id}</code>`,
        );
      }
      await this.telegramService.sendMessage(chatId, lines.join("\n"));
      return;
    }

    // Default: show help
    const lines = [
      "<b>📝 WordPress Commands</b>",
      "",
      "/wordpress — show recent posts",
      "/wordpress recent — recent posts",
      "/wordpress pending — pending publish requests",
      "",
      "To publish, use the admin panel to create and approve a PublishRequest.",
    ];
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  // /publish — list pending/approved publish requests and allow dry-run or execute
  async handlePublish(chatId: string, text: string): Promise<void> {
    const lower = text.toLowerCase();

    // /publish <requestId> — execute a specific approved request
    const parts = text.trim().split(/\s+/);
    if (
      parts.length === 2 &&
      !lower.includes("list") &&
      !lower.includes("schedule")
    ) {
      const requestId = parts[1];
      try {
        const req = await this.publishingService.getRequest(requestId);
        if (req.status !== "APPROVED") {
          await this.telegramService.sendMessage(
            chatId,
            `⚠️ PublishRequest <code>${requestId}</code> is <b>${req.status}</b>.\nOnly APPROVED requests can be executed.`,
          );
          return;
        }
        await this.telegramService.sendMessage(
          chatId,
          `🚀 Executing publish request…`,
        );
        const result = await this.publishingService.execute(requestId);
        await this.telegramService.sendMessage(
          chatId,
          [
            `${result.status === "LIVE" ? "✅" : "⚠️"} <b>Publish ${result.status}</b>`,
            result.remoteUrl ? `URL: ${result.remoteUrl}` : "",
            result.error ? `Error: ${result.error}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (err: any) {
        await this.telegramService.sendMessage(
          chatId,
          `❌ Publish failed: ${err.message}`,
        );
      }
      return;
    }

    // Default: list pending + approved requests
    const requests = await this.publishingService.listRequests();
    const pending = requests.filter((r) =>
      ["PENDING", "APPROVED"].includes(r.status),
    );

    if (pending.length === 0) {
      await this.telegramService.sendMessage(
        chatId,
        "No pending publish requests.\n\nCreate one via the admin panel for an approved draft.",
      );
      return;
    }

    const lines = [
      `<b>📤 Pending Publish Requests (${pending.length})</b>`,
      "",
    ];
    for (const r of pending.slice(0, 10)) {
      const scheduled = r.scheduledAt
        ? ` — scheduled ${fmtDate(r.scheduledAt)}`
        : "";
      lines.push(
        `• [${r.status}] <b>${r.provider}</b>${scheduled}`,
        `  Draft: <code>${r.contentDraftId.slice(0, 8)}…</code>`,
        `  ID: <code>${r.id}</code>`,
        `  Use: /publish ${r.id}`,
        "",
      );
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  // /scheduled — show scheduled publish requests
  async handleScheduled(chatId: string): Promise<void> {
    const requests = await this.publishingService.listRequests();
    const scheduled = requests.filter(
      (r) =>
        r.scheduledAt &&
        ["PENDING", "APPROVED", "SUCCEEDED"].includes(r.status),
    );

    if (scheduled.length === 0) {
      await this.telegramService.sendMessage(chatId, "No scheduled posts.");
      return;
    }

    const lines = [`<b>🗓 Scheduled Posts (${scheduled.length})</b>`, ""];
    for (const r of scheduled.slice(0, 10)) {
      const pub = (r as any).publication;
      lines.push(
        `• <b>${r.provider}</b> [${r.status}] — ${fmtDate(r.scheduledAt!)}`,
        `  ID: <code>${r.id}</code>`,
        pub?.remoteUrl ? `  URL: ${pub.remoteUrl}` : "",
        "",
      );
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n").trim());
  }

  // /published — show recently published posts
  async handlePublished(chatId: string): Promise<void> {
    const requests = await this.publishingService.listRequests({
      status: "SUCCEEDED",
    });

    if (requests.length === 0) {
      await this.telegramService.sendMessage(chatId, "No published posts yet.");
      return;
    }

    const lines = [`<b>✅ Published Posts (${requests.length})</b>`, ""];
    for (const r of requests.slice(0, 10)) {
      const pub = (r as any).publication;
      lines.push(
        `• <b>${r.provider}</b> — ${fmtDate(r.executedAt ?? r.updatedAt)}`,
        pub?.remoteUrl ? `  ${pub.remoteUrl}` : `  ID: <code>${r.id}</code>`,
        "",
      );
    }
    await this.telegramService.sendMessage(chatId, lines.join("\n").trim());
  }

  private async sendApprovalRequest(
    chatId: string,
    approval: any,
  ): Promise<void> {
    const urgency = approval.metadata?.urgency ?? "medium";
    const urgencyEmoji =
      urgency === "high" ? "🔴" : urgency === "medium" ? "🟡" : "🟢";

    const text = [
      `🔔 <b>Approval Required</b> ${urgencyEmoji}`,
      "",
      `<b>${approval.subject}</b>`,
      approval.description,
    ].join("\n");

    await this.telegramService.sendMessage(chatId, text, {
      approvalId: approval.id,
      replyMarkup: {
        inline_keyboard: [
          [
            {
              text: "✅ Approve",
              callback_data: `approval:${approval.id}:APPROVED`,
            },
            {
              text: "❌ Reject",
              callback_data: `approval:${approval.id}:REJECTED`,
            },
          ],
        ],
      },
    });
  }

  async handleMarket(chatId: string): Promise<void> {
    let ctx: any;
    try {
      ctx = await this.marketContext.build();
    } catch (err: any) {
      await this.telegramService.sendMessage(
        chatId,
        "⚠️ Market intelligence unavailable.",
      );
      return;
    }

    const lines: string[] = ["<b>📈 Market Intelligence</b>", ""];

    if (ctx.topOpportunities?.length) {
      lines.push("<b>Top Opportunities</b>");
      for (const o of ctx.topOpportunities.slice(0, 3)) {
        lines.push(
          `• <b>${o.topic}</b> — ${o.score}/100\n  ${o.recommendedAction.replace(/_/g, " ")} · ${o.source}`,
        );
      }
      lines.push("");
    }

    if (ctx.risingKeywords?.length) {
      lines.push(
        `<b>Rising Keywords</b>: ${ctx.risingKeywords.map((k: any) => k.keyword).join(", ")}`,
      );
      lines.push("");
    }

    if (ctx.contentGaps?.length) {
      lines.push(
        `<b>Content Gaps</b>: ${ctx.contentGaps.slice(0, 5).join(", ")}`,
      );
      lines.push("");
    }

    if (ctx.audienceQuestions?.length) {
      lines.push("<b>Audience Questions</b>");
      ctx.audienceQuestions
        .slice(0, 3)
        .forEach((q: string) => lines.push(`• "${q}"`));
      lines.push("");
    }

    const f = ctx.dataFreshness;
    lines.push(
      `<i>Data: SC=${f.searchConsole} Trends=${f.trends} KP=${f.keywordPlanner}</i>`,
    );

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleSeo(chatId: string): Promise<void> {
    let ctx: any;
    try {
      ctx = await this.marketContext.build();
    } catch {
      await this.telegramService.sendMessage(
        chatId,
        "⚠️ SEO data unavailable.",
      );
      return;
    }

    const lines: string[] = ["<b>🔍 SEO Intelligence</b>", ""];

    if (ctx.searchConsoleOpportunities?.length) {
      lines.push("<b>Search Console Opportunities</b>");
      for (const o of ctx.searchConsoleOpportunities.slice(0, 5)) {
        const pos = o.position ? ` (pos ${o.position.toFixed(1)})` : "";
        const imp = o.impressions ? ` · ${o.impressions} impr` : "";
        lines.push(
          `• ${o.type.replace(/_/g, " ")}: <b>${o.keyword}</b>${pos}${imp}`,
        );
      }
      lines.push("");
    }

    if (ctx.contentGaps?.length) {
      lines.push(`<b>Content Gaps</b>`);
      ctx.contentGaps.forEach((g: string) => lines.push(`• ${g}`));
      lines.push("");
    }

    if (ctx.funnelDiagnostics?.length) {
      lines.push("<b>Funnel Issues</b>");
      ctx.funnelDiagnostics
        .slice(0, 3)
        .forEach((d: any) =>
          lines.push(`• ${d.productName}: ${d.issue.replace(/_/g, " ")}`),
        );
    }

    if (!ctx.searchConsoleOpportunities?.length && !ctx.contentGaps?.length) {
      lines.push(
        "No SEO data yet. Trigger a sync: POST /market-intelligence/sync",
      );
    }

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleKeywords(chatId: string): Promise<void> {
    let ctx: any;
    try {
      ctx = await this.marketContext.build();
    } catch {
      await this.telegramService.sendMessage(
        chatId,
        "⚠️ Keyword data unavailable.",
      );
      return;
    }

    const lines: string[] = ["<b>🔑 Keyword Intelligence</b>", ""];

    if (ctx.risingKeywords?.length) {
      lines.push(
        "<b>Rising</b>: " +
          ctx.risingKeywords.map((k: any) => k.keyword).join(", "),
      );
      lines.push("");
    }

    if (ctx.onsiteSearches?.length) {
      lines.push("<b>Top Onsite Searches</b>");
      ctx.onsiteSearches
        .slice(0, 8)
        .forEach((s: any) => lines.push(`• "${s.query}" (${s.count}×)`));
      lines.push("");
    }

    if (ctx.communityLanguage?.length) {
      lines.push(
        "<b>Community Language</b>: " +
          ctx.communityLanguage.slice(0, 5).join(", "),
      );
    }

    if (!ctx.risingKeywords?.length && !ctx.onsiteSearches?.length) {
      lines.push(
        "No keyword data yet. Trigger: POST /market-intelligence/sync",
      );
    }

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }

  async handleRevenue(chatId: string): Promise<void> {
    let ctx: any;
    try {
      ctx = await this.revenueContext.build();
    } catch {
      await this.telegramService.sendMessage(
        chatId,
        "⚠️ Revenue data unavailable.",
      );
      return;
    }

    const lines: string[] = ["<b>💰 Revenue Optimization</b>", ""];

    const s = ctx.summary;
    lines.push(`Open opportunities: <b>${s.openOpportunities}</b>`);
    if (Object.keys(s.openByType).length) {
      for (const [type, count] of Object.entries(s.openByType)) {
        lines.push(`  • ${type}: ${count}`);
      }
    }
    lines.push("");

    const l30 = s.last30Days;
    lines.push("<b>Last 30 days</b>");
    lines.push(`  Recovered: ${l30.recovered}`);
    lines.push(`  Revenue: $${l30.totalRevenue.toFixed(2)}`);
    lines.push(
      `  Contribution profit: $${l30.totalContributionProfit.toFixed(2)}`,
    );
    lines.push(`  Incentive cost: $${l30.totalIncentiveCost.toFixed(2)}`);

    if (ctx.activeExperiments?.length) {
      lines.push("");
      lines.push(
        `<b>Active experiments</b>: ${ctx.activeExperiments.map((e: any) => e.name).join(", ")}`,
      );
    }

    if (!s.openOpportunities && !l30.recovered) {
      lines.push("");
      lines.push(
        "No revenue data yet. Trigger: POST /revenue/opportunities/sync",
      );
    }

    await this.telegramService.sendMessage(chatId, lines.join("\n"));
  }
}

function formatDecision(run: any): string {
  const payload = run.decisionPayload as any;
  const confidence = Math.round(run.confidence * 100);

  const header = decisionHeader(run.decisionType);
  const body = decisionBody(run.decisionType, payload);

  return [
    header,
    "",
    body,
    "",
    run.rationale,
    "",
    `<i>Confidence: ${confidence}% · ${run.modelId}</i>`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

function decisionHeader(type: string): string {
  const map: Record<string, string> = {
    CREATE_CONTENT: "📝 <b>Create Content</b>",
    START_RESEARCH: "🔍 <b>Research</b>",
    PROPOSE_CAMPAIGN: "🚀 <b>Campaign Proposal</b>",
    REQUEST_APPROVAL: "🔔 <b>Approval Required</b>",
    SEND_UPDATE: "📤 <b>Send Update</b>",
    NO_ACTION: "✋ <b>No Action Needed</b>",
  };
  return map[type] ?? `<b>${type}</b>`;
}

function decisionBody(type: string, payload: any): string {
  switch (type) {
    case "CREATE_CONTENT":
      return [
        `Type: ${payload.contentType}`,
        `Topic: ${payload.topic}`,
        `Audience: ${payload.targetAudience}`,
        `Channels: ${(payload.suggestedChannels ?? []).join(", ")}`,
      ].join("\n");
    case "START_RESEARCH":
      return [
        `Topic: ${payload.topic}`,
        `Questions:\n${(payload.questions ?? []).map((q: string) => `  • ${q}`).join("\n")}`,
      ].join("\n");
    case "PROPOSE_CAMPAIGN":
      return [
        `Name: ${payload.campaignName}`,
        `Objective: ${payload.objective}`,
        `Audience: ${payload.targetAudience}`,
        `Duration: ${payload.estimatedDuration}`,
        `Channels: ${(payload.channels ?? []).join(", ")}`,
      ].join("\n");
    case "SEND_UPDATE":
      return [`To: ${payload.recipient}`, `Subject: ${payload.subject}`].join(
        "\n",
      );
    case "NO_ACTION":
      return payload.reason ?? "";
    default:
      return "";
  }
}

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildDraftPreview(
  content: any,
  channel: string,
  format: string,
): string {
  if (!content) return "(no content)";
  const truncate = (s: string, n = 300) =>
    s.length > n ? s.slice(0, n) + "…" : s;

  switch (channel) {
    case "INSTAGRAM":
      if (format === "CAROUSEL") {
        const hook = content.hookSlide ?? "";
        const slideCount = content.slides?.length ?? 0;
        return `Hook: ${truncate(hook, 150)}\n[${slideCount} slides]\nCTA: ${content.closingCta ?? ""}`;
      }
      return truncate(content.caption ?? "");
    case "X":
      if (content.thread?.length) {
        return content.thread
          .slice(0, 3)
          .map((t: string, i: number) => `${i + 1}. ${t}`)
          .join("\n");
      }
      return truncate(content.text ?? "");
    case "LINKEDIN":
      return truncate(content.text ?? "");
    case "REDDIT":
      return `${content.title ?? ""}\n\n${truncate(content.body ?? "", 200)}`;
    case "BLOG":
      return `${content.title ?? ""}\n\n${(content.outline ?? [])
        .slice(0, 4)
        .map((s: string) => `• ${s}`)
        .join("\n")}`;
    default:
      return truncate(content.text ?? content.caption ?? "");
  }
}

function formatWeekly(review: WeeklyReview): string {
  const lines: string[] = [
    `📊 <b>Weekly CMO Review${review.brandName ? ` — ${review.brandName}` : ""}</b>`,
    `${fmtDate(review.periodStart)} → ${fmtDate(review.periodEnd)}`,
    "",
  ];

  if (review.interpretation.status === "AVAILABLE") {
    if (review.interpretation.headline) {
      lines.push(`<b>${review.interpretation.headline}</b>`);
    }
    if (review.interpretation.narrative) {
      lines.push(review.interpretation.narrative);
    }
    lines.push("");
  }

  const b = review.business;
  if (b.revenue != null) {
    lines.push(
      `💰 Business [${b.status}]: ${b.revenue.toFixed(0)} ${b.currencyCode ?? ""}, ${b.orderCount} orders, AOV ${b.aov?.toFixed(0) ?? "?"}${b.revenueDeltaPct != null ? ` (${b.revenueDeltaPct > 0 ? "+" : ""}${b.revenueDeltaPct}% vs prev)` : ""}`,
    );
  } else {
    lines.push(`💰 Business data: ${b.status}`);
  }

  const c = review.content;
  lines.push(
    `📝 Content: ${c.published} published, ${c.failedPublications} failed, ${c.measured} measured (${c.outperformed}↑ ${c.expected}= ${c.underperformed}↓ ${c.inconclusive}?)`,
  );
  lines.push(
    `📈 Market: ${review.market.newOpportunities} new opportunities, ${review.market.briefsCreated} briefs`,
  );

  const rev = review.revenue;
  lines.push(
    `💵 Attributed (last-touch, not incremental): ${rev.attributedRevenue.toFixed(0)} ${rev.currencyCode ?? ""} revenue, ${rev.attributedProfit.toFixed(0)} profit, ${rev.incentiveCost.toFixed(0)} incentives. Experiment-backed incremental: ${rev.incrementalEstimate.toFixed(0)}. ${rev.recoveredOrders} recovered checkouts.`,
  );

  for (const e of review.experiments.slice(0, 3)) {
    lines.push(`🧪 ${e.name}: ${e.state}`);
  }

  const r = review.recommendations;
  lines.push(
    `✅ Recommendations: ${r.proposed} proposed, ${r.approved} approved, ${r.rejected} rejected, ${r.executed} executed, ${r.measured} measured${r.unmeasured > 0 ? `, ${r.unmeasured} past window unmeasured` : ""}${r.failedExecutions > 0 ? `, ${r.failedExecutions} failed` : ""}`,
  );
  for (const w of r.wins) {
    lines.push(`🏆 ${w.title}${w.summary ? ` — ${w.summary}` : ""}`);
  }
  for (const l of r.losses) {
    lines.push(`⚠️ ${l.title}${l.summary ? ` — ${l.summary}` : ""}`);
  }
  if (review.interpretation.status === "UNAVAILABLE") {
    lines.push("", "<i>CMO interpretation unavailable — numbers only.</i>");
  }
  return lines.join("\n");
}
