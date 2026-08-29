import { Injectable, Logger } from "@nestjs/common";
import type {
  WebsiteAuditUrl,
  WebsiteFindingCategory,
  WebsiteSettings,
} from "@ai-cmo/contracts";
import {
  WebsiteSettingsPatchSchema,
  WebsiteSettingsSchema,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import { SettingsValidationError } from "../settings/runtime-settings.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

/**
 * Website audit configuration is business configuration, so it lives in the
 * database and is edited from Settings — not in .env (A6).
 *
 * WEBSITE_URL is read once at bootstrap to seed the row and never again.
 */
export const CODE_WEBSITE_DEFAULTS: WebsiteSettings = {
  websiteUrl: null,
  auditUrls: [],
  enabledCategories: [
    "PERFORMANCE",
    "SEO",
    "ACCESSIBILITY",
    "BEST_PRACTICE",
    "CONVERSION",
    "CONTENT",
    "MOBILE",
    "TRUST",
    "PRODUCT_PAGE",
    "CHECKOUT",
    "TECHNICAL",
  ],
  cadence: "MANUAL",
  maxPages: 10,
  formFactor: "MOBILE",
  croReviewEnabled: true,
  auditTimeoutMs: 120_000,
};

@Injectable()
export class WebsiteSettingsService {
  private readonly logger = new Logger(WebsiteSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureBootstrapped(brandId = DEFAULT_BRAND_ID): Promise<void> {
    const existing = await this.prisma.websiteSettings.findUnique({
      where: { brandId },
    });
    if (existing) return;

    // Bootstrap-only: a later env change must not overwrite persisted config.
    const envUrl = (process.env.WEBSITE_URL ?? "").trim() || null;
    await this.prisma.websiteSettings.create({
      data: {
        brandId,
        websiteUrl: this.safeUrlOrNull(envUrl),
        auditUrls: [],
        enabledCategories: CODE_WEBSITE_DEFAULTS.enabledCategories,
        cadence: CODE_WEBSITE_DEFAULTS.cadence,
        maxPages: CODE_WEBSITE_DEFAULTS.maxPages,
        formFactor: CODE_WEBSITE_DEFAULTS.formFactor,
        croReviewEnabled: CODE_WEBSITE_DEFAULTS.croReviewEnabled,
        auditTimeoutMs: CODE_WEBSITE_DEFAULTS.auditTimeoutMs,
      },
    });
    this.logger.log(`Bootstrapped WebsiteSettings for ${brandId}`);
  }

  async get(brandId = DEFAULT_BRAND_ID): Promise<WebsiteSettings> {
    await this.ensureBootstrapped(brandId);
    const row = await this.prisma.websiteSettings.findUnique({
      where: { brandId },
    });
    if (!row) return CODE_WEBSITE_DEFAULTS;

    const candidate = {
      websiteUrl: row.websiteUrl,
      auditUrls: Array.isArray(row.auditUrls) ? row.auditUrls : [],
      enabledCategories: Array.isArray(row.enabledCategories)
        ? row.enabledCategories
        : CODE_WEBSITE_DEFAULTS.enabledCategories,
      cadence: row.cadence,
      maxPages: row.maxPages,
      formFactor: row.formFactor,
      croReviewEnabled: row.croReviewEnabled,
      auditTimeoutMs: row.auditTimeoutMs,
    };

    const parsed = WebsiteSettingsSchema.safeParse(candidate);
    if (!parsed.success) {
      // Same posture as RuntimeSettingsService: a bad persisted row degrades
      // to safe defaults rather than bricking every read.
      this.logger.error(
        `Invalid persisted WebsiteSettings for ${brandId} — falling back to defaults.`,
      );
      return CODE_WEBSITE_DEFAULTS;
    }
    return parsed.data;
  }

  async patch(
    patch: unknown,
    brandId = DEFAULT_BRAND_ID,
  ): Promise<WebsiteSettings> {
    const parsed = WebsiteSettingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new SettingsValidationError(parsed.error.flatten());
    }
    await this.ensureBootstrapped(brandId);
    const current = await this.get(brandId);
    const merged = WebsiteSettingsSchema.parse({ ...current, ...parsed.data });

    await this.prisma.websiteSettings.update({
      where: { brandId },
      data: {
        websiteUrl: merged.websiteUrl,
        auditUrls: merged.auditUrls as any,
        enabledCategories: merged.enabledCategories as any,
        cadence: merged.cadence,
        maxPages: merged.maxPages,
        formFactor: merged.formFactor,
        croReviewEnabled: merged.croReviewEnabled,
        auditTimeoutMs: merged.auditTimeoutMs,
      },
    });
    return merged;
  }

  /**
   * The concrete page list for an audit: explicitly configured URLs first,
   * with the site root implied when the owner has not listed it.
   */
  async resolveAuditTargets(
    brandId = DEFAULT_BRAND_ID,
  ): Promise<WebsiteAuditUrl[]> {
    const settings = await this.get(brandId);
    const targets: WebsiteAuditUrl[] = [];
    const seen = new Set<string>();

    const push = (t: WebsiteAuditUrl) => {
      const key = t.url.toLowerCase().replace(/\/$/, "");
      if (seen.has(key)) return;
      seen.add(key);
      targets.push(t);
    };

    if (settings.websiteUrl) {
      push({ url: settings.websiteUrl, pageType: "HOMEPAGE", label: "Homepage" });
    }
    for (const t of settings.auditUrls) push(t);

    return targets.slice(0, settings.maxPages);
  }

  isCategoryEnabled(
    settings: WebsiteSettings,
    category: WebsiteFindingCategory,
  ): boolean {
    return settings.enabledCategories.includes(category);
  }

  private safeUrlOrNull(raw: string | null): string | null {
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return u.protocol === "http:" || u.protocol === "https:"
        ? u.toString()
        : null;
    } catch {
      return null;
    }
  }
}
