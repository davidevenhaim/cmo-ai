import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { assertSafeUrl } from "../research/providers/browser-crawl.adapter";
import type {
  BrowserActionRequest,
  BrowserActionResult,
} from "./browser-action.types";

/**
 * Deterministic browser execution via Browserless.
 * READ_PAGE / VERIFY_DRAFT are supported now.
 * CREATE_DRAFT / UPDATE_DRAFT require an explicit site adapter (WordPress API
 * preferred). Generic form-filling is intentionally UNSUPPORTED to avoid
 * uncontrolled automation.
 */
@Injectable()
export class BrowserActionService {
  private readonly logger = new Logger(BrowserActionService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return !!(this.config.get<string>("BROWSERLESS_URL") ?? "").trim();
  }

  async execute(req: BrowserActionRequest): Promise<BrowserActionResult> {
    const startedAt = new Date();
    const finish = (
      partial: Omit<
        BrowserActionResult,
        "startedAt" | "completedAt" | "action" | "url"
      >,
    ): BrowserActionResult => ({
      ...partial,
      action: req.type,
      url: req.url,
      startedAt,
      completedAt: new Date(),
    });

    if (!this.configured) {
      return finish({
        status: "NOT_CONFIGURED",
        verified: false,
        detail: "BROWSERLESS_URL not set",
      });
    }

    try {
      assertSafeUrl(req.url);
    } catch (err: any) {
      return finish({
        status: "REJECTED",
        verified: false,
        detail: err.message,
      });
    }

    if (req.type === "CREATE_DRAFT" || req.type === "UPDATE_DRAFT") {
      return finish({
        status: "UNSUPPORTED",
        verified: false,
        detail:
          "Generic browser draft mutation is disabled. Use WordPress/Postiz publishers or a site-specific adapter.",
      });
    }

    try {
      if (req.type === "READ_PAGE") {
        const page = await this.fetchPage(req.url);
        return finish({
          status: "SUCCEEDED",
          verified: true,
          title: page.title,
          excerpt: page.text.slice(0, 500),
          finalUrl: page.finalUrl,
          detail: "Page read via Browserless",
        });
      }

      // VERIFY_DRAFT — success only if expected URL/text present
      const page = await this.fetchPage(req.url);
      const expectedUrl = req.payload?.expectedUrlSubstring;
      const expectedText =
        req.payload?.expectedTextSubstring ??
        req.payload?.title ??
        req.payload?.body?.slice(0, 80);

      const urlOk = expectedUrl
        ? page.finalUrl.includes(expectedUrl) || req.url.includes(expectedUrl)
        : true;
      const textOk = expectedText
        ? page.text.toLowerCase().includes(expectedText.toLowerCase())
        : true;

      if (!expectedText && !expectedUrl) {
        return finish({
          status: "FAILED",
          verified: false,
          title: page.title,
          excerpt: page.text.slice(0, 500),
          finalUrl: page.finalUrl,
          detail:
            "VERIFY_DRAFT requires expectedUrlSubstring or expectedTextSubstring — click alone is not success",
        });
      }

      if (urlOk && textOk) {
        return finish({
          status: "SUCCEEDED",
          verified: true,
          title: page.title,
          excerpt: page.text.slice(0, 500),
          finalUrl: page.finalUrl,
          detail: "Draft verified against page content",
        });
      }

      return finish({
        status: "FAILED",
        verified: false,
        title: page.title,
        excerpt: page.text.slice(0, 500),
        finalUrl: page.finalUrl,
        detail: `Verification failed (urlOk=${urlOk}, textOk=${textOk})`,
      });
    } catch (err: any) {
      this.logger.warn(`Browser action ${req.type} failed: ${err.message}`);
      return finish({
        status: "FAILED",
        verified: false,
        detail: err.message,
      });
    }
  }

  private async fetchPage(url: string): Promise<{
    title: string;
    text: string;
    finalUrl: string;
  }> {
    const base = (this.config.get<string>("BROWSERLESS_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
    const token = this.config.get<string>("BROWSERLESS_TOKEN") ?? "";
    const timeout = parseInt(
      this.config.get("BROWSER_ACTION_TIMEOUT_MS") ?? "20000",
      10,
    );
    const endpoint = token
      ? `${base}/content?token=${encodeURIComponent(token)}`
      : `${base}/content`;

    const response = await firstValueFrom(
      this.http.post(
        endpoint,
        { url, gotoOptions: { waitUntil: "networkidle2", timeout } },
        {
          timeout,
          headers: { "Content-Type": "application/json" },
          transformResponse: [(data) => data],
        },
      ),
    );

    const raw = response.data;
    const html =
      typeof raw === "string"
        ? raw
        : String((raw as any)?.data ?? (raw as any)?.html ?? "");
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || url;
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return { title, text, finalUrl: url };
  }
}
