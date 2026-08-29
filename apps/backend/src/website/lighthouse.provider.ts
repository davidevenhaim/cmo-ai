import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { assertSafeUrl } from "../research/providers/browser-crawl.adapter";

/**
 * Outcome of one page audit.
 *
 * The distinction matters downstream: NOT_CONFIGURED / UNAVAILABLE mean the
 * provider itself is unusable (the whole audit fails), while FAILED / TIMEOUT
 * are per-page problems that leave the rest of the audit valid.
 */
export type LighthouseStatus =
  | "OK"
  | "FAILED"
  | "TIMEOUT"
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "REJECTED";

export interface LighthouseRunResult {
  status: LighthouseStatus;
  /** Raw Lighthouse report. Never forwarded to an LLM. */
  lhr?: unknown;
  failureReason?: string;
  durationMs?: number;
}

@Injectable()
export class LighthouseProvider {
  private readonly logger = new Logger(LighthouseProvider.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return (this.config.get<string>("LIGHTHOUSE_BASE_URL") ?? "")
      .trim()
      .replace(/\/$/, "");
  }

  get configured(): boolean {
    return !!this.baseUrl;
  }

  async run(
    url: string,
    opts: { formFactor?: "MOBILE" | "DESKTOP"; timeoutMs?: number } = {},
  ): Promise<LighthouseRunResult> {
    if (!this.configured) {
      return {
        status: "NOT_CONFIGURED",
        failureReason: "LIGHTHOUSE_BASE_URL not set",
      };
    }

    // The runner enforces this too, but rejecting here keeps a bad audit URL
    // from ever leaving the backend.
    try {
      assertSafeUrl(url);
    } catch (err: any) {
      return { status: "REJECTED", failureReason: err.message };
    }

    const timeoutMs = opts.timeoutMs ?? 120_000;
    const started = Date.now();

    try {
      const response = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/audit`,
          {
            url,
            formFactor: opts.formFactor ?? "MOBILE",
            timeoutMs,
          },
          {
            // Allow the runner's own timeout to fire first so we get its
            // structured error rather than a bare socket hangup.
            timeout: timeoutMs + 30_000,
            headers: { "Content-Type": "application/json" },
            validateStatus: (s) => s === 200 || s === 422,
          },
        ),
      );

      const data = response.data as any;
      if (response.status === 422 || data?.ok === false) {
        return {
          status: "FAILED",
          failureReason: String(data?.error ?? "audit failed"),
          durationMs: Date.now() - started,
        };
      }
      if (!data?.lhr) {
        return {
          status: "FAILED",
          failureReason: "runner returned no report",
          durationMs: Date.now() - started,
        };
      }
      return {
        status: "OK",
        lhr: data.lhr,
        durationMs: data.durationMs ?? Date.now() - started,
      };
    } catch (err: any) {
      const timedOut =
        err?.code === "ECONNABORTED" || /timeout/i.test(err?.message ?? "");
      // Connection refused / DNS failure means the runner is down — that is a
      // provider outage, not a bad page.
      const unreachable =
        err?.code === "ECONNREFUSED" ||
        err?.code === "ENOTFOUND" ||
        err?.code === "EAI_AGAIN";

      this.logger.warn(`Lighthouse run failed for ${url}: ${err.message}`);
      return {
        status: timedOut ? "TIMEOUT" : unreachable ? "UNAVAILABLE" : "FAILED",
        failureReason: err.message,
        durationMs: Date.now() - started,
      };
    }
  }
}
