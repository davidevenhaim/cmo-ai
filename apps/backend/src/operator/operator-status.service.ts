import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ConnectionStatus, OperatorStatus } from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { ShopifyGraphqlAdapter } from "../shopify/shopify-graphql.adapter";

const BRAND_ID = "luminesce-brand-001";
const SHOPIFY_STALE_HOURS = 24;

@Injectable()
export class OperatorStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly shopifyAdapter: ShopifyGraphqlAdapter,
  ) {}

  // Cheap, config/DB-based checks only — no external calls. Use per-card
  // "Test connection" (safe read-only health endpoints) for live checks.
  async getStatus(): Promise<OperatorStatus> {
    const [shopify, market] = await Promise.all([
      this.shopifyStatus(),
      this.marketSyncInfo(),
    ]);

    const connections: ConnectionStatus[] = [
      shopify,
      this.envBased({
        key: "telegram",
        name: "Telegram",
        vars: ["TELEGRAM_BOT_TOKEN"],
        detail: "Bot for mobile brief, approvals and queries",
      }),
      this.envBased({
        key: "waha",
        name: "WAHA (WhatsApp)",
        vars: ["WAHA_BASE_URL"],
        detail:
          "Customer messaging channel. All sends pass consent, frequency and economics gates",
      }),
      this.envBased({
        key: "wordpress",
        name: "WordPress",
        vars: [
          "WORDPRESS_BASE_URL",
          "WORDPRESS_USERNAME",
          "WORDPRESS_APPLICATION_PASSWORD",
        ],
        detail: "Blog publishing target",
        testable: true,
      }),
      this.envBased({
        key: "postiz",
        name: "Postiz",
        vars: ["POSTIZ_API_KEY"],
        detail: "Social publishing (IG/FB/LinkedIn/X/Reddit)",
        testable: true,
      }),
      this.mockProvider(
        "search-console",
        "Search Console",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
        market,
      ),
      this.mockProvider("trends", "Google Trends", "SERPAPI_KEY", market),
      this.mockProvider(
        "keyword-planner",
        "Keyword Planner",
        "GOOGLE_ADS_DEVELOPER_TOKEN",
        market,
      ),
      this.envBased({
        key: "brave",
        name: "Brave Search",
        vars: ["BRAVE_SEARCH_API_KEY"],
        detail: "Web research provider",
      }),
      this.envBased({
        key: "firecrawl",
        name: "Firecrawl",
        vars: ["FIRECRAWL_API_KEY"],
        detail: "Competitor page scraping",
      }),
      {
        key: "email",
        name: "Email",
        health: "MOCK",
        detail:
          "Mock email provider active — no real email is sent. No real provider is implemented",
        lastSuccessAt: null,
        configRequirements: [],
        testable: false,
      },
      {
        key: "creative",
        name: "Creative Provider",
        health: "NOT_CONFIGURED",
        detail:
          "AI image/video generation not integrated (deferred). No provider available",
        lastSuccessAt: null,
        configRequirements: [],
        testable: false,
      },
    ];

    return { generatedAt: new Date(), connections };
  }

  private async shopifyStatus(): Promise<ConnectionStatus> {
    const base = {
      key: "shopify",
      name: "Shopify",
      configRequirements: ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ACCESS_TOKEN"],
      testable: true,
    };
    if (!this.shopifyAdapter.configured) {
      return {
        ...base,
        health: "NOT_CONFIGURED",
        detail: "Store domain and access token missing or placeholder values",
        lastSuccessAt: null,
      };
    }
    const latest = await this.prisma.commerceSnapshot.findFirst({
      where: { brandId: BRAND_ID },
      orderBy: { snapshotAt: "desc" },
    });
    if (!latest) {
      return {
        ...base,
        health: "STALE",
        detail: "Configured but no commerce snapshot yet — run a sync",
        lastSuccessAt: null,
      };
    }
    if (!latest.available) {
      return {
        ...base,
        health: "ERROR",
        detail: latest.failureReason ?? "Last snapshot failed",
        lastSuccessAt: null,
      };
    }
    const ageHours =
      (Date.now() - latest.snapshotAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > SHOPIFY_STALE_HOURS) {
      return {
        ...base,
        health: "STALE",
        detail: `Last successful snapshot ${Math.round(ageHours)}h ago`,
        lastSuccessAt: latest.snapshotAt,
      };
    }
    return {
      ...base,
      health: "CONNECTED",
      detail: latest.shopName ? `Connected to ${latest.shopName}` : "Connected",
      lastSuccessAt: latest.snapshotAt,
    };
  }

  private async marketSyncInfo(): Promise<Date | null> {
    const run = await this.prisma.marketIntelligenceSyncRun.findFirst({
      where: { brandId: BRAND_ID, status: { in: ["COMPLETED", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
    });
    return run?.completedAt ?? null;
  }

  // Market intelligence module always wires mock providers — real
  // implementations don't exist yet, so health is MOCK regardless of env.
  private mockProvider(
    key: string,
    name: string,
    requiredVar: string,
    lastSyncAt: Date | null,
  ): ConnectionStatus {
    return {
      key,
      name,
      health: "MOCK",
      detail: `Mock data only — real ${name} provider not implemented. Mock metrics never create opportunities`,
      lastSuccessAt: lastSyncAt,
      configRequirements: [requiredVar],
      testable: false,
    };
  }

  private envBased(opts: {
    key: string;
    name: string;
    vars: string[];
    detail: string;
    testable?: boolean;
  }): ConnectionStatus {
    const missing = opts.vars.filter(
      (v) => !this.config.get<string>(v, "").trim(),
    );
    const configured = missing.length === 0;
    return {
      key: opts.key,
      name: opts.name,
      health: configured ? "CONNECTED" : "NOT_CONFIGURED",
      detail: configured
        ? opts.detail
        : `Missing configuration: ${missing.join(", ")}`,
      lastSuccessAt: null,
      configRequirements: opts.vars,
      testable: opts.testable ?? false,
    };
  }
}
