import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import {
  classifyRemoteError,
  ContentPublisher,
  HealthResult,
  PublishResult,
  ValidationResult,
} from "../publishing/content-publisher.interface";

// Channels Postiz supports that we expose — only these, no fake support.
export const SUPPORTED_CHANNELS = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "X",
  "REDDIT",
] as const;

export type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

export interface PostizPost {
  id: string;
  state: "DRAFT" | "QUEUE" | "PUBLISHED" | "ERROR";
  content: string;
  publishDate?: string;
  integration?: { id: string; name: string; type: string };
}

@Injectable()
export class PostizPublisher implements ContentPublisher {
  readonly provider = "postiz";
  private readonly logger = new Logger(PostizPublisher.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return (this.config.get<string>("POSTIZ_BASE_URL") ?? "").replace(
      /\/$/,
      "",
    );
  }

  private get apiKey(): string {
    return this.config.get<string>("POSTIZ_API_KEY") ?? "";
  }

  private get configured(): boolean {
    return !!(
      this.config.get("POSTIZ_BASE_URL") && this.config.get("POSTIZ_API_KEY")
    );
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async health(): Promise<HealthResult> {
    if (!this.configured) {
      return {
        healthy: false,
        message:
          "Postiz not configured (POSTIZ_BASE_URL / POSTIZ_API_KEY missing)",
      };
    }
    try {
      await firstValueFrom(
        this.http.get(`${this.baseUrl}/api/v1/integrations`, {
          headers: this.headers(),
          timeout: 8000,
        }),
      );
      return { healthy: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { healthy: false, message: `Postiz unreachable: ${msg}` };
    }
  }

  async validateDraft(
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const errors: string[] = [];

    const channel = (
      providerMetadata?.["channel"] as string | undefined
    )?.toUpperCase();
    if (!channel) {
      errors.push(
        "providerMetadata.channel is required (e.g. INSTAGRAM, LINKEDIN)",
      );
    } else if (!SUPPORTED_CHANNELS.includes(channel as SupportedChannel)) {
      errors.push(
        `Channel ${channel} not supported. Supported: ${SUPPORTED_CHANNELS.join(", ")}`,
      );
    }

    if (!providerMetadata?.["accountId"]) {
      errors.push(
        "providerMetadata.accountId (Postiz integration ID) is required",
      );
    }

    const body =
      (draftContent["caption"] as string) ??
      (draftContent["body"] as string) ??
      (draftContent["content"] as string) ??
      "";

    if (!body.trim()) {
      errors.push("Post body/caption/content must not be empty");
    }

    return { valid: errors.length === 0, errors };
  }

  async createRemoteDraft(
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult> {
    if (!this.configured) {
      return { status: "FAILED", error: "Postiz not configured" };
    }

    const validation = await this.validateDraft(draftContent, providerMetadata);
    if (!validation.valid) {
      return { status: "FAILED", error: validation.errors.join("; ") };
    }

    const payload = this.buildPayload(draftContent, providerMetadata, "DRAFT");

    try {
      const resp = await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/v1/posts`, payload, {
          headers: this.headers(),
          timeout: 15000,
        }),
      );
      const post = resp.data as PostizPost;
      return {
        remoteId: post.id,
        status: "DRAFT",
        metadata: {
          postizState: post.state,
          channel: providerMetadata?.["channel"],
        },
      };
    } catch (err: unknown) {
      const msg = this.extractError(err);
      this.logger.error(`Postiz createRemoteDraft failed: ${msg}`);
      return { status: classifyRemoteError(err), error: msg };
    }
  }

  async updateRemoteDraft(
    remoteId: string,
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult> {
    if (!this.configured) {
      return { status: "FAILED", error: "Postiz not configured" };
    }

    const payload = this.buildPayload(draftContent, providerMetadata, "DRAFT");

    try {
      const resp = await firstValueFrom(
        this.http.put(`${this.baseUrl}/api/v1/posts/${remoteId}`, payload, {
          headers: this.headers(),
          timeout: 15000,
        }),
      );
      const post = resp.data as PostizPost;
      return {
        remoteId: post.id,
        status: "DRAFT",
        metadata: { postizState: post.state },
      };
    } catch (err: unknown) {
      const msg = this.extractError(err);
      this.logger.error(`Postiz updateRemoteDraft failed: ${msg}`);
      return { status: classifyRemoteError(err), error: msg };
    }
  }

  // Submits existing draft for publish (immediate or scheduled via providerMetadata.scheduledAt).
  // Default: QUEUE (scheduled) rather than immediate — immediate requires explicit intent.
  async publish(
    remoteId: string,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult> {
    if (!this.configured) {
      return { status: "FAILED", error: "Postiz not configured" };
    }

    const scheduledAt = providerMetadata?.["scheduledAt"] as string | undefined;
    const payload: Record<string, unknown> = { state: "QUEUE" };
    if (scheduledAt) payload["publishDate"] = scheduledAt;

    try {
      const resp = await firstValueFrom(
        this.http.put(`${this.baseUrl}/api/v1/posts/${remoteId}`, payload, {
          headers: this.headers(),
          timeout: 15000,
        }),
      );
      const post = resp.data as PostizPost;
      const live = post.state === "PUBLISHED";
      return {
        remoteId: post.id,
        status: live ? "LIVE" : "DRAFT",
        metadata: { postizState: post.state, scheduledAt },
      };
    } catch (err: unknown) {
      const msg = this.extractError(err);
      this.logger.error(`Postiz publish failed: ${msg}`);
      return { status: classifyRemoteError(err), error: msg };
    }
  }

  async getPublication(remoteId: string): Promise<PublishResult | null> {
    if (!this.configured) return null;
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.baseUrl}/api/v1/posts/${remoteId}`, {
          headers: this.headers(),
          timeout: 8000,
        }),
      );
      const post = resp.data as PostizPost;
      return {
        remoteId: post.id,
        status:
          post.state === "PUBLISHED"
            ? "LIVE"
            : post.state === "ERROR"
              ? "FAILED"
              : "DRAFT",
        metadata: { postizState: post.state },
      };
    } catch {
      return null;
    }
  }

  private buildPayload(
    draftContent: Record<string, unknown>,
    providerMetadata: Record<string, unknown> | undefined,
    state: "DRAFT" | "QUEUE",
  ): Record<string, unknown> {
    const content =
      (draftContent["caption"] as string) ??
      (draftContent["body"] as string) ??
      (draftContent["content"] as string) ??
      "";

    return {
      integrationId: providerMetadata?.["accountId"],
      content,
      state,
      ...(providerMetadata?.["scheduledAt"]
        ? { publishDate: providerMetadata["scheduledAt"] }
        : {}),
    };
  }

  private extractError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
