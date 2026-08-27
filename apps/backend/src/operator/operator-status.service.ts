import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
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
    private readonly http: HttpService,
  ) {}

  // Cheap, config/DB-based checks only — no external calls except LLM health
  // probe via brain (no secrets returned). Use per-card "Test connection" for
  // live checks on other providers.
  async getStatus(): Promise<OperatorStatus> {
    const [shopify, market, llm] = await Promise.all([
      this.shopifyStatus(),
      this.marketSyncInfo(),
      this.llmStatus(),
    ]);

    const searchProvider = (
      this.config.get<string>("SEARCH_PROVIDER") ?? "searxng"
    )
      .trim()
      .toLowerCase();
    const crawlProvider = (
      this.config.get<string>("CRAWL_PROVIDER") ?? "crawl4ai"
    )
      .trim()
      .toLowerCase();

    const connections: ConnectionStatus[] = [
      llm,
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
      searchProvider === "brave"
        ? this.envBased({
            key: "search",
            name: "Search (Brave)",
            vars: ["BRAVE_SEARCH_API_KEY"],
            detail: "Optional cloud search — SEARCH_PROVIDER=brave",
          })
        : this.envBased({
            key: "search",
            name: "Search (SearXNG)",
            vars: ["SEARXNG_BASE_URL"],
            detail: "Self-hosted research search — Nest owns all queries",
          }),
      this.crawlStatus(crawlProvider),
      this.emailStatus(),
      this.envBased({
        key: "umami",
        name: "Umami Analytics",
        vars: ["UMAMI_BASE_URL", "UMAMI_WEBSITE_ID", "UMAMI_API_TOKEN"],
        detail:
          "Self-hosted analytics → PerformanceObservation (MOCK excluded from conclusions)",
      }),
      this.envBased({
        key: "changedetection",
        name: "Changedetection",
        vars: ["CHANGEDETECTION_WEBHOOK_TOKEN"],
        detail:
          "Competitor URL watch → research findings only (no auto-publish)",
      }),
      this.envBased({
        key: "listmonk",
        name: "listmonk",
        vars: ["LISTMONK_BASE_URL", "LISTMONK_USERNAME", "LISTMONK_PASSWORD"],
        detail:
          "Self-hosted email execution — Nest owns consent/frequency/approval",
      }),
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

  private async llmStatus(): Promise<ConnectionStatus> {
    const brainUrl = (
      this.config.get<string>("BRAIN_URL") ?? "http://localhost:8000"
    ).replace(/\/$/, "");
    const base = {
      key: "llm",
      name: "LLM",
      configRequirements: ["LLM_PROVIDER"],
      testable: false,
    };
    try {
      const res = await firstValueFrom(
        this.http.get(`${brainUrl}/health`, { timeout: 4000 }),
      );
      const llm = (res.data as any)?.llm;
      if (!llm || typeof llm !== "object") {
        return {
          ...base,
          health: "ERROR",
          detail: "Brain health missing llm block",
          lastSuccessAt: null,
        };
      }
      const provider = String(llm.provider ?? "unknown");
      const model = llm.model ? String(llm.model) : null;
      const configured = !!llm.configured;
      const reachable = !!llm.reachable;
      const lastError =
        typeof llm.lastError === "string" ? llm.lastError : null;

      let health: ConnectionStatus["health"] = "NOT_CONFIGURED";
      if (configured && reachable) health = "CONNECTED";
      else if (configured && !reachable) health = "ERROR";
      else health = "NOT_CONFIGURED";

      const parts = [
        `Provider: ${provider === "ollama" ? "Ollama" : provider === "anthropic" ? "Anthropic" : provider}`,
      ];
      if (model) parts.push(`Model: ${model}`);
      if (lastError) parts.push(lastError);

      return {
        ...base,
        name: "LLM",
        health,
        detail: parts.join(" · "),
        lastSuccessAt: health === "CONNECTED" ? new Date() : null,
        configRequirements:
          provider === "ollama"
            ? ["LLM_PROVIDER", "OLLAMA_BASE_URL", "OLLAMA_MODEL"]
            : ["LLM_PROVIDER", "CLAUDE_API_KEY"],
      };
    } catch (err: any) {
      return {
        ...base,
        health: "ERROR",
        detail: `Brain unreachable: ${err.message}`,
        lastSuccessAt: null,
        configRequirements: ["BRAIN_URL", "LLM_PROVIDER"],
      };
    }
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

  private crawlStatus(choice: string): ConnectionStatus {
    if (choice === "firecrawl") {
      return this.envBased({
        key: "crawl",
        name: "Crawl (Firecrawl)",
        vars: ["FIRECRAWL_API_KEY"],
        detail: "Optional cloud crawl — CRAWL_PROVIDER=firecrawl",
      });
    }
    if (choice === "browser") {
      return this.envBased({
        key: "crawl",
        name: "Crawl (Browser)",
        vars: ["BROWSERLESS_URL"],
        detail: "Browserless-only crawl",
      });
    }
    // default crawl4ai (+ browser fallback)
    const hasCrawl4ai = !!this.config
      .get<string>("CRAWL4AI_BASE_URL", "")
      .trim();
    const hasBrowser = !!this.config.get<string>("BROWSERLESS_URL", "").trim();
    if (!hasCrawl4ai && !hasBrowser) {
      return {
        key: "crawl",
        name: "Crawl (Crawl4AI → Browser)",
        health: "NOT_CONFIGURED",
        detail: "Missing CRAWL4AI_BASE_URL and BROWSERLESS_URL",
        lastSuccessAt: null,
        configRequirements: ["CRAWL4AI_BASE_URL", "BROWSERLESS_URL"],
        testable: false,
      };
    }
    return {
      key: "crawl",
      name: "Crawl (Crawl4AI → Browser)",
      health: "CONNECTED",
      detail: hasCrawl4ai
        ? "Crawl4AI primary; Browserless fallback when configured"
        : "Browserless only (Crawl4AI URL missing)",
      lastSuccessAt: null,
      configRequirements: ["CRAWL4AI_BASE_URL", "BROWSERLESS_URL"],
      testable: false,
    };
  }

  private emailStatus(): ConnectionStatus {
    const listmonkConfigured =
      !!this.config.get<string>("LISTMONK_BASE_URL", "").trim() &&
      !!this.config.get<string>("LISTMONK_USERNAME", "").trim() &&
      !!this.config.get<string>("LISTMONK_PASSWORD", "").trim();
    if (listmonkConfigured) {
      return {
        key: "email",
        name: "Email (listmonk)",
        health: "CONNECTED",
        detail:
          "listmonk execution provider — Nest still owns consent, frequency caps, and approval",
        lastSuccessAt: null,
        configRequirements: [
          "LISTMONK_BASE_URL",
          "LISTMONK_USERNAME",
          "LISTMONK_PASSWORD",
        ],
        testable: false,
      };
    }
    return {
      key: "email",
      name: "Email (Mock)",
      health: "MOCK",
      detail:
        "MockEmailProvider active — no real email is sent. Configure listmonk for self-hosted delivery",
      lastSuccessAt: null,
      configRequirements: [
        "LISTMONK_BASE_URL",
        "LISTMONK_USERNAME",
        "LISTMONK_PASSWORD",
      ],
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
        : `${opts.detail}. Missing: ${missing.join(", ")}`,
      lastSuccessAt: null,
      configRequirements: opts.vars,
      testable: opts.testable ?? false,
    };
  }
}
