import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { isIP } from "net";
import type { CrawlProvider, ExtractResult } from "./crawl.provider";

const MAX_CONTENT_CHARS = 2000;
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|\[::1\]|0\.0\.0\.0)/i;

/**
 * Self-hosted browser crawl via Browserless (or compatible /content API).
 * SSRF-hardened: http(s) only, blocks private/link-local hosts.
 */
@Injectable()
export class BrowserCrawlAdapter implements CrawlProvider {
  readonly name = "browser";
  private readonly logger = new Logger(BrowserCrawlAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get configured(): boolean {
    return !!this.baseUrl;
  }

  private get baseUrl(): string {
    return (this.config.get<string>("BROWSERLESS_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  async extract(url: string): Promise<ExtractResult> {
    if (!this.configured) {
      throw new Error("Browser crawl not configured (BROWSERLESS_URL)");
    }
    assertSafeUrl(url);

    const timeout = parseInt(
      this.config.get("RESEARCH_REQUEST_TIMEOUT_MS") ?? "20000",
    );
    const token = this.config.get<string>("BROWSERLESS_TOKEN") ?? "";
    const endpoint = token
      ? `${this.baseUrl}/content?token=${encodeURIComponent(token)}`
      : `${this.baseUrl}/content`;

    try {
      const response = await firstValueFrom(
        this.http.post<string | BrowserlessPayload>(
          endpoint,
          {
            url,
            gotoOptions: { waitUntil: "networkidle2", timeout },
          },
          {
            timeout,
            headers: { "Content-Type": "application/json" },
            responseType: "json" as any,
            // Browserless may return HTML string or JSON depending on version.
            transformResponse: [(data) => data],
          },
        ),
      );

      const raw = response.data;
      let html = "";
      let title = "";
      let canonical = url;

      if (typeof raw === "string") {
        html = raw;
      } else if (raw && typeof raw === "object") {
        html = String((raw as BrowserlessPayload).data ?? raw.html ?? "");
        title = String((raw as BrowserlessPayload).title ?? "");
      }

      const text = htmlToReadableText(html).slice(0, MAX_CONTENT_CHARS);
      if (!title) title = extractTitle(html) || url;
      const canon = extractCanonical(html);
      if (canon) {
        try {
          assertSafeUrl(canon);
          canonical = canon;
        } catch {
          /* keep original */
        }
      }

      if (!text.trim()) {
        throw new Error(`Browser crawl returned empty content for ${url}`);
      }

      return {
        url: canonical,
        title,
        content: text,
        metadata: { description: text.slice(0, 300) },
      };
    } catch (err: any) {
      this.logger.warn(`Browser crawl failed for ${url}: ${err.message}`);
      throw new Error(`Browser crawl failed: ${err.message}`);
    }
  }
}

export function assertSafeUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsafe URL protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (PRIVATE_HOST_RE.test(host) || host.endsWith(".local")) {
    throw new Error(`Blocked private/local host: ${host}`);
  }
  const ipVersion = isIP(host);
  if (ipVersion) {
    if (isPrivateIp(host)) {
      throw new Error(`Blocked private IP: ${host}`);
    }
  }
}

function isPrivateIp(ip: string): boolean {
  if (
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  )
    return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function htmlToReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function extractCanonical(html: string): string | null {
  const m = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  );
  return m?.[1] ?? null;
}

interface BrowserlessPayload {
  data?: string;
  html?: string;
  title?: string;
}
