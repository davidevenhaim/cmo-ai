import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import {
  ShopifyGraphqlAdapter,
  RawShopifyCustomer,
  RawShopifyAbandonedCheckout,
} from "../shopify/shopify-graphql.adapter";
import { ContactService } from "./contact.service";
import { AbandonedCheckoutService } from "./abandoned-checkout.service";

const BRAND_ID = "luminesce-brand-001";
// Reconcile orders from the last N days to detect recovered checkouts.
const RECOVERY_LOOKBACK_DAYS = 60;

export interface GrowthSyncResult {
  runId: string;
  status: string;
  customersFetched: number;
  checkoutsFetched: number;
  contactsCreated: number;
  contactsUpdated: number;
  checkoutsCreated: number;
  checkoutsUpdated: number;
  recovered: number;
  errors: string[];
}

@Injectable()
export class GrowthSyncService {
  private readonly logger = new Logger(GrowthSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyGraphqlAdapter,
    private readonly contacts: ContactService,
    private readonly abandonedCheckouts: AbandonedCheckoutService,
  ) {}

  async getLatestRun() {
    return this.prisma.growthSyncRun.findFirst({
      where: { brandId: BRAND_ID },
      orderBy: { startedAt: "desc" },
    });
  }

  async isRunning(): Promise<boolean> {
    const running = await this.prisma.growthSyncRun.findFirst({
      where: { brandId: BRAND_ID, status: "RUNNING" },
    });
    return Boolean(running);
  }

  async run(): Promise<GrowthSyncResult> {
    if (!this.shopify.configured) {
      throw new Error("Shopify not configured — cannot run growth sync");
    }

    if (await this.isRunning()) {
      throw new Error(
        "Growth sync is already running — skipping concurrent run",
      );
    }

    const syncRun = await this.prisma.growthSyncRun.create({
      data: { brandId: BRAND_ID, status: "RUNNING" },
    });

    const errors: string[] = [];
    let customersFetched = 0;
    let checkoutsFetched = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let checkoutsCreated = 0;
    let checkoutsUpdated = 0;
    let recovered = 0;

    // ── Step 1: Sync customers → contacts ──────────────────────────────────
    try {
      const result = await this.syncCustomers();
      customersFetched = result.fetched;
      contactsCreated = result.created;
      contactsUpdated = result.updated;
      if (result.truncated) {
        errors.push("Customer list truncated at 2500 — sync is incomplete");
      }
    } catch (err: any) {
      const msg = `Customer sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
    }

    // ── Step 2: Sync abandoned checkouts ───────────────────────────────────
    try {
      const result = await this.syncAbandonedCheckouts();
      checkoutsFetched = result.fetched;
      checkoutsCreated = result.created;
      checkoutsUpdated = result.updated;
      if (result.truncated) {
        errors.push(
          "Abandoned checkout list truncated at 2500 — sync is incomplete",
        );
      }
    } catch (err: any) {
      const msg = `Abandoned checkout sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
    }

    // ── Step 3: Reconcile with recent orders → mark RECOVERED ──────────────
    try {
      const since = new Date(
        Date.now() - RECOVERY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      );
      const until = new Date();
      const { items: orders, truncated } = await this.shopify.fetchOrders(
        since,
        until,
      );
      if (truncated) {
        errors.push(
          "Order list truncated — recovery detection may be incomplete",
        );
      }
      recovered = await this.abandonedCheckouts.reconcileWithOrders(orders);
    } catch (err: any) {
      const msg = `Recovery reconciliation failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
    }

    // ── Step 4: Expire old checkouts ───────────────────────────────────────
    try {
      await this.abandonedCheckouts.expireOld();
    } catch (err: any) {
      errors.push(`Expiry step failed: ${err.message}`);
    }

    const status =
      errors.length === 0
        ? "COMPLETED"
        : customersFetched === 0 && checkoutsFetched === 0
          ? "FAILED"
          : "PARTIAL";

    await this.prisma.growthSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status,
        completedAt: new Date(),
        customersFetched,
        checkoutsFetched,
        contactsCreated,
        contactsUpdated,
        checkoutsCreated,
        checkoutsUpdated,
        recovered,
        errors: errors.length ? errors : undefined,
        failureReason: status === "FAILED" ? errors[0] : undefined,
      },
    });

    this.logger.log(
      `Growth sync ${status}: ${customersFetched} customers, ${checkoutsFetched} checkouts, ${recovered} recovered`,
    );

    return {
      runId: syncRun.id,
      status,
      customersFetched,
      checkoutsFetched,
      contactsCreated,
      contactsUpdated,
      checkoutsCreated,
      checkoutsUpdated,
      recovered,
      errors,
    };
  }

  private async syncCustomers(): Promise<{
    fetched: number;
    created: number;
    updated: number;
    truncated: boolean;
  }> {
    const { items, truncated } = await this.shopify.fetchCustomers();
    let created = 0;
    let updated = 0;

    for (const raw of items) {
      try {
        const existing = await this.contacts.findByShopifyId(raw.id);
        const dto = this.normalizeCustomer(raw);
        await this.contacts.upsert(dto);
        if (existing) {
          updated++;
        } else {
          created++;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to upsert customer ${raw.id}: ${err.message}`);
      }
    }

    return { fetched: items.length, created, updated, truncated };
  }

  private async syncAbandonedCheckouts(): Promise<{
    fetched: number;
    created: number;
    updated: number;
    truncated: boolean;
  }> {
    const { items, truncated } = await this.shopify.fetchAbandonedCheckouts();
    let created = 0;
    let updated = 0;

    for (const raw of items) {
      try {
        const existing = await this.prisma.abandonedCheckout.findUnique({
          where: { shopifyCheckoutId: raw.id },
        });
        await this.upsertAbandonedCheckout(raw);
        if (existing) {
          updated++;
        } else {
          created++;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to upsert checkout ${raw.id}: ${err.message}`);
      }
    }

    return { fetched: items.length, created, updated, truncated };
  }

  private async upsertAbandonedCheckout(
    raw: RawShopifyAbandonedCheckout,
  ): Promise<void> {
    const email = raw.customer?.email ?? null;

    let contactId: string | null = null;
    if (email) {
      const contact = await this.contacts.findByEmail(email);
      if (contact) contactId = contact.id;
    }

    const lineItems = raw.lineItems.edges.map(({ node }) => ({
      title: node.title,
      quantity: node.quantity,
      shopifyProductId: node.variant?.product?.id ?? null,
      variantId: node.variant?.id ?? null,
      sku: node.variant?.sku ?? null,
      price: parseFloat(node.originalTotalSet.shopMoney.amount),
      currency: node.originalTotalSet.shopMoney.currencyCode,
    }));

    const totalValue = parseFloat(raw.totalPriceSet.shopMoney.amount);
    const currencyCode = raw.totalPriceSet.shopMoney.currencyCode;

    await this.prisma.abandonedCheckout.upsert({
      where: { shopifyCheckoutId: raw.id },
      create: {
        brandId: BRAND_ID,
        shopifyCheckoutId: raw.id,
        contactId,
        email,
        lineItems,
        totalValue,
        currencyCode,
        abandonedAt: new Date(raw.createdAt),
        recoveryUrl: raw.abandonedCheckoutUrl,
        checkoutToken: raw.token,
        status: "ACTIVE",
      },
      update: {
        // Shopify is authoritative — always overwrite identity/value fields.
        contactId: contactId ?? undefined,
        email: email ?? undefined,
        lineItems,
        totalValue,
        currencyCode,
        recoveryUrl: raw.abandonedCheckoutUrl,
        checkoutToken: raw.token,
      },
    });
  }

  // Shopify is authoritative for marketing consent.
  // marketingState values: SUBSCRIBED, NOT_SUBSCRIBED, UNSUBSCRIBED, PENDING, REDACTED, INVALID
  // Fail closed: anything not explicitly SUBSCRIBED is treated as NOT_SUBSCRIBED.
  private normalizeCustomer(raw: RawShopifyCustomer) {
    const emailState =
      raw.emailMarketingConsent?.marketingState ?? "NOT_SUBSCRIBED";
    const smsState =
      raw.smsMarketingConsent?.marketingState ?? "NOT_SUBSCRIBED";

    return {
      shopifyCustomerId: raw.id,
      email: raw.email ?? null,
      phone: raw.phone ?? null,
      firstName: raw.firstName ?? null,
      lastName: raw.lastName ?? null,
      emailMarketingStatus: this.normalizeMarketingState(emailState),
      smsMarketingStatus: this.normalizeMarketingState(smsState),
      orderCount: raw.numberOfOrders,
      lifetimeRevenue: parseFloat(raw.amountSpent.amount),
      currencyCode: raw.amountSpent.currencyCode,
    };
  }

  // SUBSCRIBED → SUBSCRIBED. Anything else → NOT_SUBSCRIBED (fail closed).
  // This invariant must not be weakened without explicit owner decision.
  private normalizeMarketingState(state: string): string {
    const upper = state.toUpperCase();
    if (upper === "SUBSCRIBED") return "SUBSCRIBED";
    if (upper === "UNSUBSCRIBED") return "UNSUBSCRIBED";
    if (upper === "PENDING") return "PENDING";
    if (upper === "REDACTED") return "REDACTED";
    return "NOT_SUBSCRIBED";
  }
}
