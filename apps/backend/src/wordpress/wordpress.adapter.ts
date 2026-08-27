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

export interface WpPost {
  id: number;
  date: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  link: string;
  status: string;
  categories: number[];
  tags: number[];
}

export interface WpCategory {
  id: number;
  name: string;
  slug: string;
}

export interface BlogContext {
  available: boolean;
  siteUrl: string;
  recentPosts: Array<{
    id: number;
    title: string;
    url: string;
    publishedAt: string;
    status: string;
  }>;
  categories: WpCategory[];
  fetchedAt: string;
  failureReason?: string;
}

@Injectable()
export class WordPressAdapter implements ContentPublisher {
  readonly provider = "wordpress";
  private readonly logger = new Logger(WordPressAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return (this.config.get<string>("WORDPRESS_BASE_URL") ?? "").replace(
      /\/$/,
      "",
    );
  }

  private get credentials(): string {
    const user = this.config.get<string>("WORDPRESS_USERNAME") ?? "";
    const pass =
      this.config.get<string>("WORDPRESS_APPLICATION_PASSWORD") ?? "";
    return Buffer.from(`${user}:${pass}`).toString("base64");
  }

  private get configured(): boolean {
    return !!(
      this.config.get("WORDPRESS_BASE_URL") &&
      this.config.get("WORDPRESS_USERNAME") &&
      this.config.get("WORDPRESS_APPLICATION_PASSWORD")
    );
  }

  private headers() {
    return {
      Authorization: `Basic ${this.credentials}`,
      "Content-Type": "application/json",
    };
  }

  async health(): Promise<HealthResult> {
    if (!this.configured) {
      return {
        healthy: false,
        message:
          "WordPress not configured (WORDPRESS_BASE_URL/USERNAME/APPLICATION_PASSWORD missing)",
      };
    }
    try {
      await firstValueFrom(
        this.http.get(`${this.baseUrl}/wp-json/wp/v2/users/me`, {
          headers: this.headers(),
          timeout: 8000,
        }),
      );
      return { healthy: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { healthy: false, message: `WordPress unreachable: ${msg}` };
    }
  }

  async validateDraft(
    draftContent: Record<string, unknown>,
    _providerMetadata?: Record<string, unknown>,
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!draftContent["title"] && !draftContent["headline"]) {
      errors.push("title or headline required");
    }
    if (!draftContent["body"] && !draftContent["content"]) {
      errors.push("body or content required");
    }
    return { valid: errors.length === 0, errors };
  }

  async createRemoteDraft(
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult> {
    if (!this.configured) {
      return {
        status: "FAILED",
        error: "WordPress not configured",
      };
    }

    const payload = this.buildWpPayload(
      draftContent,
      providerMetadata,
      "draft",
    );

    try {
      const resp = await firstValueFrom(
        this.http.post(`${this.baseUrl}/wp-json/wp/v2/posts`, payload, {
          headers: this.headers(),
          timeout: 15000,
        }),
      );
      const post = resp.data as WpPost;
      return {
        remoteId: String(post.id),
        remoteUrl: post.link,
        status: "DRAFT",
        metadata: { wpStatus: post.status, postId: post.id },
      };
    } catch (err: unknown) {
      const msg = this.extractError(err);
      this.logger.error(`WordPress createRemoteDraft failed: ${msg}`);
      return { status: classifyRemoteError(err), error: msg };
    }
  }

  async updateRemoteDraft(
    remoteId: string,
    draftContent: Record<string, unknown>,
    providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult> {
    if (!this.configured) {
      return { status: "FAILED", error: "WordPress not configured" };
    }

    const payload = this.buildWpPayload(
      draftContent,
      providerMetadata,
      "draft",
    );

    try {
      const resp = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/wp-json/wp/v2/posts/${remoteId}`,
          payload,
          { headers: this.headers(), timeout: 15000 },
        ),
      );
      const post = resp.data as WpPost;
      return {
        remoteId: String(post.id),
        remoteUrl: post.link,
        status: "DRAFT",
        metadata: { wpStatus: post.status, postId: post.id },
      };
    } catch (err: unknown) {
      const msg = this.extractError(err);
      this.logger.error(`WordPress updateRemoteDraft failed: ${msg}`);
      return { status: classifyRemoteError(err), error: msg };
    }
  }

  async publish(
    remoteId: string,
    _providerMetadata?: Record<string, unknown>,
  ): Promise<PublishResult> {
    if (!this.configured) {
      return { status: "FAILED", error: "WordPress not configured" };
    }

    try {
      const resp = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/wp-json/wp/v2/posts/${remoteId}`,
          { status: "publish" },
          { headers: this.headers(), timeout: 15000 },
        ),
      );
      const post = resp.data as WpPost;
      return {
        remoteId: String(post.id),
        remoteUrl: post.link,
        status: "LIVE",
        metadata: { wpStatus: post.status, postId: post.id },
      };
    } catch (err: unknown) {
      const msg = this.extractError(err);
      this.logger.error(`WordPress publish failed: ${msg}`);
      return { status: classifyRemoteError(err), error: msg };
    }
  }

  async getPublication(remoteId: string): Promise<PublishResult | null> {
    if (!this.configured) return null;
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.baseUrl}/wp-json/wp/v2/posts/${remoteId}`, {
          headers: this.headers(),
          timeout: 8000,
        }),
      );
      const post = resp.data as WpPost;
      return {
        remoteId: String(post.id),
        remoteUrl: post.link,
        status: post.status === "publish" ? "LIVE" : "DRAFT",
        metadata: { wpStatus: post.status },
      };
    } catch {
      return null;
    }
  }

  async getRecentPosts(count = 10): Promise<WpPost[]> {
    if (!this.configured) return [];
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.baseUrl}/wp-json/wp/v2/posts`, {
          params: { per_page: count, orderby: "date", order: "desc" },
          headers: this.headers(),
          timeout: 10000,
        }),
      );
      return resp.data as WpPost[];
    } catch (err: unknown) {
      this.logger.warn(
        `WordPress getRecentPosts failed: ${this.extractError(err)}`,
      );
      return [];
    }
  }

  async getCategories(): Promise<WpCategory[]> {
    if (!this.configured) return [];
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.baseUrl}/wp-json/wp/v2/categories`, {
          params: { per_page: 50 },
          headers: this.headers(),
          timeout: 8000,
        }),
      );
      return resp.data as WpCategory[];
    } catch (err: unknown) {
      this.logger.warn(
        `WordPress getCategories failed: ${this.extractError(err)}`,
      );
      return [];
    }
  }

  async buildBlogContext(): Promise<BlogContext> {
    const siteUrl = this.baseUrl;

    if (!this.configured) {
      return {
        available: false,
        siteUrl,
        recentPosts: [],
        categories: [],
        fetchedAt: new Date().toISOString(),
        failureReason: "WordPress not configured",
      };
    }

    const [posts, categories] = await Promise.all([
      this.getRecentPosts(10),
      this.getCategories(),
    ]);

    return {
      available: true,
      siteUrl,
      recentPosts: posts.map((p) => ({
        id: p.id,
        title: p.title.rendered,
        url: p.link,
        publishedAt: p.date,
        status: p.status,
      })),
      categories,
      fetchedAt: new Date().toISOString(),
    };
  }

  private buildWpPayload(
    draftContent: Record<string, unknown>,
    providerMetadata: Record<string, unknown> | undefined,
    status: "draft" | "publish",
  ): Record<string, unknown> {
    const title =
      (draftContent["title"] as string) ??
      (draftContent["headline"] as string) ??
      "";
    const content =
      (draftContent["body"] as string) ??
      (draftContent["content"] as string) ??
      "";
    const excerpt =
      (draftContent["excerpt"] as string) ??
      (draftContent["caption"] as string) ??
      "";

    const payload: Record<string, unknown> = {
      title,
      content,
      excerpt,
      status,
    };

    if (providerMetadata?.["categories"]) {
      payload["categories"] = providerMetadata["categories"];
    }
    if (providerMetadata?.["tags"]) {
      payload["tags"] = providerMetadata["tags"];
    }

    return payload;
  }

  private extractError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
