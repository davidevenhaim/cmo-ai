import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { CommerceSettings, RevenuePolicy } from "@ai-cmo/contracts";
import {
  CommerceSettingsPatchSchema,
  CommerceSettingsSchema,
  RevenuePolicyPatchSchema,
  RevenuePolicySchema,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";
import {
  bootstrapCommerceDefaults,
  bootstrapRevenueDefaults,
  CODE_COMMERCE_DEFAULTS,
  CODE_REVENUE_DEFAULTS,
} from "./settings.defaults";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

@Injectable()
export class RuntimeSettingsService implements OnModuleInit {
  private readonly logger = new Logger(RuntimeSettingsService.name);
  private commerceCache: CommerceSettings | null = null;
  private revenueCache: RevenuePolicy | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureBootstrapped(DEFAULT_BRAND_ID);
    await this.refreshCache(DEFAULT_BRAND_ID);
  }

  /**
   * Create rows once from bootstrap env / code defaults.
   * Never overwrites existing persisted values.
   */
  async ensureBootstrapped(brandId: string = DEFAULT_BRAND_ID): Promise<void> {
    // Bootstrap env is operator-supplied and unvalidated. Persisting an
    // out-of-range value would make every later read fail schema validation,
    // which bricks startup until the row is edited by hand.
    const commerceBootstrap = this.validated(
      CommerceSettingsSchema,
      bootstrapCommerceDefaults(),
      CODE_COMMERCE_DEFAULTS,
      "commerce bootstrap env",
    );
    const revenueBootstrap = this.validated(
      RevenuePolicySchema,
      bootstrapRevenueDefaults(),
      CODE_REVENUE_DEFAULTS,
      "revenue bootstrap env",
    );

    const existingCommerce = await this.prisma.commerceSettings.findUnique({
      where: { brandId },
    });
    if (!existingCommerce) {
      await this.prisma.commerceSettings.create({
        data: {
          brandId,
          lowStockThreshold: commerceBootstrap.lowStockThreshold,
          defaultMetricsPeriodDays: commerceBootstrap.defaultMetricsPeriodDays,
        },
      });
      await this.recordAudit(
        brandId,
        "COMMERCE",
        "*",
        null,
        commerceBootstrap,
        "BOOTSTRAP",
      );
      this.logger.log(`Bootstrapped CommerceSettings for ${brandId}`);
    }

    const existingRevenue = await this.prisma.revenuePolicy.findUnique({
      where: { brandId },
    });
    if (!existingRevenue) {
      await this.prisma.revenuePolicy.create({
        data: {
          brandId,
          maxDiscountPct: revenueBootstrap.maxDiscountPct,
          minContributionMarginPct: revenueBootstrap.minContributionMarginPct,
          minOrderValue: revenueBootstrap.minOrderValue,
          maxDiscountsPerJourney: revenueBootstrap.maxDiscountsPerJourney,
          minHoursBeforeDiscount: revenueBootstrap.minHoursBeforeDiscount,
          recoveryLadderHours: revenueBootstrap.recoveryLadderHours,
          winBackDays: revenueBootstrap.winBackDays,
          vipLtvThreshold: revenueBootstrap.vipLtvThreshold,
          freeShippingNearFactor: revenueBootstrap.freeShippingNearFactor,
        },
      });
      await this.recordAudit(
        brandId,
        "REVENUE",
        "*",
        null,
        revenueBootstrap,
        "BOOTSTRAP",
      );
      this.logger.log(`Bootstrapped RevenuePolicy for ${brandId}`);
    }
  }

  async refreshCache(brandId: string = DEFAULT_BRAND_ID): Promise<void> {
    this.commerceCache = await this.loadCommerce(brandId);
    this.revenueCache = await this.loadRevenue(brandId);
  }

  /** Sync read for hot paths — uses in-memory cache populated at init / after writes. */
  getCommerceSync(): CommerceSettings {
    return this.commerceCache ?? CODE_COMMERCE_DEFAULTS;
  }

  getRevenueSync(): RevenuePolicy {
    return this.revenueCache ?? CODE_REVENUE_DEFAULTS;
  }

  async getCommerce(
    brandId: string = DEFAULT_BRAND_ID,
  ): Promise<CommerceSettings> {
    await this.ensureBootstrapped(brandId);
    const settings = await this.loadCommerce(brandId);
    if (brandId === DEFAULT_BRAND_ID) this.commerceCache = settings;
    return settings;
  }

  async getRevenue(brandId: string = DEFAULT_BRAND_ID): Promise<RevenuePolicy> {
    await this.ensureBootstrapped(brandId);
    const policy = await this.loadRevenue(brandId);
    if (brandId === DEFAULT_BRAND_ID) this.revenueCache = policy;
    return policy;
  }

  async getAll(brandId: string = DEFAULT_BRAND_ID) {
    const [commerce, revenue] = await Promise.all([
      this.getCommerce(brandId),
      this.getRevenue(brandId),
    ]);
    return { commerce, revenue };
  }

  async patchCommerce(
    patch: unknown,
    opts: { brandId?: string; source?: string; actor?: string } = {},
  ): Promise<CommerceSettings> {
    const brandId = opts.brandId ?? DEFAULT_BRAND_ID;
    const source = opts.source ?? "API";
    const parsed = CommerceSettingsPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new SettingsValidationError(parsed.error.flatten());
    }
    await this.ensureBootstrapped(brandId);
    const current = await this.loadCommerce(brandId);
    const merged = CommerceSettingsSchema.parse({ ...current, ...parsed.data });

    await this.prisma.commerceSettings.update({
      where: { brandId },
      data: {
        lowStockThreshold: merged.lowStockThreshold,
        defaultMetricsPeriodDays: merged.defaultMetricsPeriodDays,
      },
    });

    for (const key of Object.keys(parsed.data) as (keyof CommerceSettings)[]) {
      if (parsed.data[key] === undefined) continue;
      if (current[key] === merged[key]) continue;
      await this.recordAudit(
        brandId,
        "COMMERCE",
        key,
        current[key],
        merged[key],
        source,
        opts.actor,
      );
    }

    if (brandId === DEFAULT_BRAND_ID) this.commerceCache = merged;
    return merged;
  }

  async patchRevenue(
    patch: unknown,
    opts: { brandId?: string; source?: string; actor?: string } = {},
  ): Promise<RevenuePolicy> {
    const brandId = opts.brandId ?? DEFAULT_BRAND_ID;
    const source = opts.source ?? "API";
    const parsed = RevenuePolicyPatchSchema.safeParse(patch);
    if (!parsed.success) {
      throw new SettingsValidationError(parsed.error.flatten());
    }
    await this.ensureBootstrapped(brandId);
    const current = await this.loadRevenue(brandId);
    const merged = RevenuePolicySchema.parse({ ...current, ...parsed.data });

    await this.prisma.revenuePolicy.update({
      where: { brandId },
      data: {
        maxDiscountPct: merged.maxDiscountPct,
        minContributionMarginPct: merged.minContributionMarginPct,
        minOrderValue: merged.minOrderValue,
        maxDiscountsPerJourney: merged.maxDiscountsPerJourney,
        minHoursBeforeDiscount: merged.minHoursBeforeDiscount,
        recoveryLadderHours: merged.recoveryLadderHours,
        winBackDays: merged.winBackDays,
        vipLtvThreshold: merged.vipLtvThreshold,
        freeShippingNearFactor: merged.freeShippingNearFactor,
      },
    });

    for (const key of Object.keys(parsed.data) as (keyof RevenuePolicy)[]) {
      if (parsed.data[key] === undefined) continue;
      const prev = current[key];
      const next = merged[key];
      if (JSON.stringify(prev) === JSON.stringify(next)) continue;
      await this.recordAudit(
        brandId,
        "REVENUE",
        key,
        prev,
        next,
        source,
        opts.actor,
      );
    }

    if (brandId === DEFAULT_BRAND_ID) this.revenueCache = merged;
    return merged;
  }

  async listAudit(brandId: string = DEFAULT_BRAND_ID, take = 50) {
    return this.prisma.settingsAuditLog.findMany({
      where: { brandId },
      orderBy: { changedAt: "desc" },
      take,
    });
  }

  private async loadCommerce(brandId: string): Promise<CommerceSettings> {
    const row = await this.prisma.commerceSettings.findUnique({
      where: { brandId },
    });
    if (!row) return CODE_COMMERCE_DEFAULTS;
    return this.validated(
      CommerceSettingsSchema,
      {
        lowStockThreshold: row.lowStockThreshold,
        defaultMetricsPeriodDays: row.defaultMetricsPeriodDays,
      },
      CODE_COMMERCE_DEFAULTS,
      `persisted CommerceSettings for ${brandId}`,
    );
  }

  private async loadRevenue(brandId: string): Promise<RevenuePolicy> {
    const row = await this.prisma.revenuePolicy.findUnique({
      where: { brandId },
    });
    if (!row) return CODE_REVENUE_DEFAULTS;
    const ladder = Array.isArray(row.recoveryLadderHours)
      ? (row.recoveryLadderHours as number[])
      : CODE_REVENUE_DEFAULTS.recoveryLadderHours;
    return this.validated(
      RevenuePolicySchema,
      {
        maxDiscountPct: row.maxDiscountPct,
        minContributionMarginPct: row.minContributionMarginPct,
        minOrderValue: row.minOrderValue,
        maxDiscountsPerJourney: row.maxDiscountsPerJourney,
        minHoursBeforeDiscount: row.minHoursBeforeDiscount,
        recoveryLadderHours: ladder,
        winBackDays: row.winBackDays,
        vipLtvThreshold: row.vipLtvThreshold,
        freeShippingNearFactor: row.freeShippingNearFactor,
      },
      CODE_REVENUE_DEFAULTS,
      `persisted RevenuePolicy for ${brandId}`,
    );
  }

  /** Parse against the contract, falling back to safe code defaults on failure. */
  private validated<T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    candidate: unknown,
    fallback: T,
    label: string,
  ): T {
    const parsed = schema.safeParse(candidate);
    if (parsed.success && parsed.data !== undefined) return parsed.data;
    this.logger.error(
      `Invalid ${label} — falling back to safe code defaults. Fix the value and restart.`,
    );
    return fallback;
  }

  private async recordAudit(
    brandId: string,
    scope: "COMMERCE" | "REVENUE",
    field: string,
    previousValue: unknown,
    newValue: unknown,
    source: string,
    actor?: string,
  ) {
    await this.prisma.settingsAuditLog.create({
      data: {
        brandId,
        scope,
        field,
        previousValue: previousValue as any,
        newValue: newValue as any,
        source,
        actor: actor ?? null,
      },
    });
  }
}

export class SettingsValidationError extends Error {
  constructor(public readonly details: unknown) {
    super("Settings validation failed");
    this.name = "SettingsValidationError";
  }
}
