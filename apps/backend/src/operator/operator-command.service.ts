import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  OperatorActionClass,
  OperatorCommand,
  OperatorCommandResult,
  OperatorIntent,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { ShopifyService } from "../shopify/shopify.service";
import { ShopifyGraphqlAdapter } from "../shopify/shopify-graphql.adapter";
import { ContentService } from "../content/content.service";
import { ContentGenerationService } from "../content/content-generation.service";
import { SegmentService } from "../growth/segment.service";
import { BundleService } from "../revenue-optimization/bundle.service";
import { ReplenishmentService } from "../growth/replenishment.service";
import { RecommendationService } from "../measurement/recommendation.service";
import { OperatorBriefService } from "./operator-brief.service";
import { OperatorAnalyticsService } from "./operator-analytics.service";
import { OperatorBrainClient } from "./operator-brain.client";

const BRAND_ID = "luminesce-brand-001";
const LIST_LIMIT = 20;
const MIN_INTENT_CONFIDENCE = 0.5;

// Every supported intent is registered here with its action class. Claude can
// only ever propose one of these — routing is deterministic Nest code.
const INTENT_CLASSIFICATION: Record<OperatorIntent, OperatorActionClass> = {
  GET_DAILY_BRIEF: "READ",
  ANALYZE_SALES: "READ",
  FIND_CONTENT_OPPORTUNITIES: "READ",
  CREATE_CONTENT_BRIEF: "PROPOSE",
  LIST_DRAFTS: "READ",
  LIST_MARKET_OPPORTUNITIES: "READ",
  LIST_ABANDONED: "READ",
  LIST_REVENUE_OPPORTUNITIES: "READ",
  PROPOSE_BUNDLE: "PROPOSE",
  LIST_WINBACK: "READ",
  LIST_REPLENISHMENT: "READ",
  LIST_CUSTOMERS: "READ",
  GET_ANALYTICS: "READ",
  SCHEDULE_CONTENT: "MUTATE",
};

const CreateBriefParamsSchema = z.object({
  topic: z.string().min(1).max(300),
  instruction: z.string().max(1000).optional(),
  channel: z.string().max(50).optional(),
});

const ScheduleContentParamsSchema = z.object({
  publishRequestId: z.string().min(1),
  scheduledAt: z.coerce.date(),
});

const ListParamsSchema = z.object({
  segment: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  days: z.number().int().min(1).max(365).optional(),
});

@Injectable()
export class OperatorCommandService {
  private readonly logger = new Logger(OperatorCommandService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
    private readonly shopifyAdapter: ShopifyGraphqlAdapter,
    private readonly content: ContentService,
    private readonly contentGeneration: ContentGenerationService,
    private readonly segments: SegmentService,
    private readonly bundles: BundleService,
    private readonly replenishment: ReplenishmentService,
    private readonly brief: OperatorBriefService,
    private readonly analytics: OperatorAnalyticsService,
    private readonly brain: OperatorBrainClient,
    private readonly recommendations: RecommendationService,
  ) {}

  async execute(command: OperatorCommand): Promise<OperatorCommandResult> {
    let intent = command.intent ?? null;
    let params: Record<string, unknown> = command.params ?? {};

    // Natural language → typed intent proposal via brain, then re-validated
    // here. An invented or low-confidence intent never routes.
    if (!intent && command.text) {
      try {
        const raw = await this.brain.classifyIntent(command.text);
        const proposal = this.brain.toValidatedProposal(raw);
        if (!proposal || proposal.confidence < MIN_INTENT_CONFIDENCE) {
          return {
            intent: null,
            classification: null,
            status: "CLARIFICATION_NEEDED",
            summary:
              proposal?.clarification ??
              raw.clarification ??
              'I couldn\'t map that to a supported action. Try e.g. "show abandoned checkouts" or "create content about <topic>".',
            data: null,
            deepLink: null,
          };
        }
        intent = proposal.intent;
        params = { ...proposal.params, ...params };
      } catch (e) {
        this.logger.warn(
          `Intent classification failed: ${(e as Error).message}`,
        );
        return {
          intent: null,
          classification: null,
          status: "ERROR",
          summary:
            "Could not classify the command (CMO brain unavailable). You can still use explicit intents.",
          data: null,
          deepLink: null,
        };
      }
    }

    if (!intent) {
      return {
        intent: null,
        classification: null,
        status: "UNSUPPORTED",
        summary: "No intent provided.",
        data: null,
        deepLink: null,
      };
    }

    const classification = INTENT_CLASSIFICATION[intent];
    try {
      return await this.route(intent, classification, params, command.confirm);
    } catch (e) {
      this.logger.error(`Command ${intent} failed: ${(e as Error).message}`);
      return {
        intent,
        classification,
        status: "ERROR",
        summary: `Command failed: ${(e as Error).message}`,
        data: null,
        deepLink: null,
      };
    }
  }

  private async route(
    intent: OperatorIntent,
    classification: OperatorActionClass,
    params: Record<string, unknown>,
    confirm: boolean,
  ): Promise<OperatorCommandResult> {
    const ok = (
      summary: string,
      data: unknown,
      deepLink: string | null = null,
    ): OperatorCommandResult => ({
      intent,
      classification,
      status: "OK",
      summary,
      data,
      deepLink,
    });

    switch (intent) {
      case "GET_DAILY_BRIEF": {
        const today = await this.brief.buildToday({ skipInterpretation: true });
        return ok("Daily brief (deterministic sections).", today, "/today");
      }

      case "ANALYZE_SALES": {
        if (!this.shopifyAdapter.configured) {
          return ok(
            "Shopify is not configured — no sales data available.",
            null,
            "/connections",
          );
        }
        const ctx = await this.shopify.getCommerceContext();
        const m = ctx.metrics;
        const summary = m
          ? `Revenue ${m.revenue.toFixed(0)} ${m.currencyCode} from ${m.orderCount} orders (AOV ${m.aov.toFixed(0)}). Data status: ${ctx.evidenceStatus}.`
          : `No sales metrics available (${ctx.evidenceStatus}).`;
        return ok(
          summary,
          {
            status: ctx.evidenceStatus,
            metrics: m,
            failureReason: ctx.failureReason,
          },
          "/analytics",
        );
      }

      case "FIND_CONTENT_OPPORTUNITIES": {
        const p = ListParamsSchema.parse(params);
        const [search, market] = await Promise.all([
          this.prisma.searchOpportunity.findMany({
            where: { brandId: BRAND_ID, status: "NEW" },
            orderBy: { score: "desc" },
            take: p.limit ?? LIST_LIMIT,
          }),
          this.prisma.marketOpportunity.findMany({
            where: { brandId: BRAND_ID, status: "NEW" },
            orderBy: { score: "desc" },
            take: p.limit ?? LIST_LIMIT,
          }),
        ]);
        return ok(
          `${search.length} search opportunities and ${market.length} market opportunities open.`,
          { searchOpportunities: search, marketOpportunities: market },
          "/market",
        );
      }

      case "CREATE_CONTENT_BRIEF": {
        const parsed = CreateBriefParamsSchema.safeParse(params);
        if (!parsed.success) {
          return {
            intent,
            classification,
            status: "CLARIFICATION_NEEDED",
            summary: "What topic should the content brief cover?",
            data: null,
            deepLink: null,
          };
        }
        const p = parsed.data;
        // Persist the request as a Recommendation so the resulting content's
        // outcome is measured once published (idempotent per topic).
        const rec = await this.recommendations.propose({
          type: "CREATE_CONTENT",
          title: `Create content: ${p.topic}`,
          rationale: "Operator requested content via command",
          evidenceRefs: [
            {
              source: "operator_command",
              refType: "TOPIC",
              refId: p.topic,
              note: null,
            },
          ],
          confidence: 0.9,
          targetType: "TOPIC",
          targetId: p.topic,
          actionClass: "PROPOSE",
        });
        const created = await this.content.createBrief({
          recommendationId: rec.id,
          objective: "Operator-requested content",
          topic: p.topic,
          angle: p.instruction ?? "Practical, evidence-based angle",
          targetAudience: "Existing and prospective customers",
          channel: (p.channel ?? "BLOG").toUpperCase(),
          format:
            (p.channel ?? "BLOG").toUpperCase() === "BLOG"
              ? "LONG_FORM"
              : "POST",
          keyMessage: p.topic,
          tone: "confident, helpful",
          constraints: p.instruction ? [p.instruction] : [],
          supportingEvidence: { items: [] },
        });
        // Fire-and-forget generation — the draft lands in /content when ready.
        void this.contentGeneration
          .generateForBrief({ briefId: created.id })
          .catch((e) =>
            this.logger.warn(
              `Draft generation for brief ${created.id} failed: ${e.message}`,
            ),
          );
        return ok(
          `Content brief created for "${p.topic}". Draft generation started — review it in the Content workspace.`,
          { briefId: created.id },
          "/content",
        );
      }

      case "LIST_DRAFTS": {
        const drafts = await this.prisma.contentDraft.findMany({
          where: {
            brandId: BRAND_ID,
            status: { in: ["GENERATED", "PENDING_REVIEW", "APPROVED"] },
          },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          include: { brief: { select: { topic: true, channel: true } } },
        });
        return ok(`${drafts.length} active drafts.`, drafts, "/content");
      }

      case "LIST_MARKET_OPPORTUNITIES": {
        const p = ListParamsSchema.parse(params);
        const opps = await this.prisma.marketOpportunity.findMany({
          where: { brandId: BRAND_ID, status: "NEW" },
          orderBy: { score: "desc" },
          take: p.limit ?? LIST_LIMIT,
        });
        return ok(`${opps.length} open market opportunities.`, opps, "/market");
      }

      case "LIST_ABANDONED": {
        const p = ListParamsSchema.parse(params);
        const rows = await this.prisma.abandonedCheckout.findMany({
          where: {
            brandId: BRAND_ID,
            status: { in: ["ACTIVE", "RECOVERY_STARTED"] },
          },
          orderBy: { totalValue: "desc" },
          take: p.limit ?? LIST_LIMIT,
        });
        // PII-minimized: no email/phone/name — ids and money only.
        const items = rows.map((r) => ({
          id: r.id,
          totalValue: r.totalValue,
          currencyCode: r.currencyCode,
          abandonedAt: r.abandonedAt,
          status: r.status,
          itemCount: Array.isArray(r.lineItems) ? r.lineItems.length : 0,
        }));
        const total = items.reduce((s, i) => s + i.totalValue, 0);
        return ok(
          `${items.length} active abandoned checkouts worth ${total.toFixed(0)} ${items[0]?.currencyCode ?? ""}.`.trim(),
          items,
          "/revenue?section=abandoned",
        );
      }

      case "LIST_REVENUE_OPPORTUNITIES": {
        const p = ListParamsSchema.parse(params);
        const opps = await this.prisma.revenueOpportunity.findMany({
          where: { brandId: BRAND_ID, status: { in: ["NEW", "IN_JOURNEY"] } },
          orderBy: { cartValue: "desc" },
          take: p.limit ?? LIST_LIMIT,
          select: {
            id: true,
            type: true,
            stage: true,
            status: true,
            cartValue: true,
            abandonedAt: true,
            createdAt: true,
          },
        });
        return ok(
          `${opps.length} open revenue opportunities.`,
          opps,
          "/revenue",
        );
      }

      case "PROPOSE_BUNDLE": {
        if (!this.shopifyAdapter.configured) {
          return ok(
            "Shopify is not configured — cannot derive a product catalog for bundles.",
            null,
            "/connections",
          );
        }
        const ctx = await this.shopify.getCommerceContext();
        const catalog = (ctx.metrics?.revenueByProduct ?? [])
          .filter((prod) => prod.units > 0)
          .map((prod) => ({
            shopifyProductId: prod.productId,
            title: prod.productTitle,
            price: prod.revenue / prod.units,
          }));
        if (catalog.length === 0) {
          return ok(
            "No product sales data available to derive bundles from.",
            null,
            "/revenue?section=bundles",
          );
        }
        // Creates bundle *proposals* only — approval and any storefront change
        // stay with the owner. No Shopify mutation happens here.
        const created = await this.bundles.suggestBundlesFromAffinity(catalog);
        return ok(
          created > 0
            ? `${created} bundle proposal(s) created from product affinity. Review and approve in Revenue.`
            : "No new bundle proposals — affinity data insufficient or bundles already exist.",
          { created },
          "/revenue?section=bundles",
        );
      }

      case "LIST_WINBACK": {
        const contacts = await this.prisma.contact.findMany({
          where: {
            brandId: BRAND_ID,
            orderCount: { gt: 0 },
            lastOrderAt: {
              lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
          orderBy: { lifetimeRevenue: "desc" },
          take: LIST_LIMIT,
          select: {
            id: true,
            orderCount: true,
            lifetimeRevenue: true,
            currencyCode: true,
            lastOrderAt: true,
            smsMarketingStatus: true,
            emailMarketingStatus: true,
          },
        });
        return ok(
          `${contacts.length} lapsed customers (no order in 90+ days). PII omitted — open Customers for detail.`,
          contacts,
          "/customers?segment=LAPSED_CUSTOMER",
        );
      }

      case "LIST_REPLENISHMENT": {
        const candidates = await this.replenishment.getCandidates();
        const summary = candidates.map((c) => ({
          productId: c.productId,
          productName: c.productName,
          windowDays: c.windowDays,
          contactCount: c.contacts.length,
        }));
        return ok(
          `${summary.reduce((s, c) => s + c.contactCount, 0)} contacts due for replenishment across ${summary.length} products.`,
          summary,
          "/customers?segment=REPLENISHMENT_DUE",
        );
      }

      case "LIST_CUSTOMERS": {
        const segments = await this.segments.getSegmentSummary();
        return ok(
          `${segments.length} customer segments (aggregated counts only).`,
          segments.map((s) => ({
            type: s.type,
            name: s.name,
            memberCount: s.memberCount,
          })),
          "/customers",
        );
      }

      case "GET_ANALYTICS": {
        const data = await this.analytics.getAnalytics();
        return ok("Analytics snapshot.", data, "/analytics");
      }

      case "SCHEDULE_CONTENT": {
        const parsed = ScheduleContentParamsSchema.safeParse(params);
        if (!parsed.success) {
          return {
            intent,
            classification,
            status: "CLARIFICATION_NEEDED",
            summary:
              "Scheduling needs a publishRequestId and a scheduledAt date.",
            data: null,
            deepLink: "/calendar",
          };
        }
        const p = parsed.data;
        const request = await this.prisma.publishRequest.findUnique({
          where: { id: p.publishRequestId },
        });
        if (!request || request.brandId !== BRAND_ID) {
          return {
            intent,
            classification,
            status: "ERROR",
            summary: `Publish request ${p.publishRequestId} not found.`,
            data: null,
            deepLink: "/calendar",
          };
        }
        if (!["PENDING", "APPROVED"].includes(request.status)) {
          return {
            intent,
            classification,
            status: "ERROR",
            summary: `Publish request is ${request.status} — only PENDING or APPROVED requests can be (re)scheduled.`,
            data: null,
            deepLink: "/calendar",
          };
        }
        if (!confirm) {
          return {
            intent,
            classification,
            status: "CONFIRMATION_REQUIRED",
            summary: `Confirm scheduling publish request ${request.id} for ${p.scheduledAt.toISOString()}. Re-send with confirm: true.`,
            data: {
              publishRequestId: request.id,
              scheduledAt: p.scheduledAt.toISOString(),
            },
            deepLink: "/calendar",
          };
        }
        const updated = await this.prisma.publishRequest.update({
          where: { id: request.id },
          data: { scheduledAt: p.scheduledAt },
        });
        return ok(
          `Publish request scheduled for ${p.scheduledAt.toISOString()}. Execution still requires approval flow.`,
          { publishRequestId: updated.id, scheduledAt: updated.scheduledAt },
          "/calendar",
        );
      }
    }
  }
}
