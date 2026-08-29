import { Injectable, Logger } from "@nestjs/common";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  extractTemplateVariables,
  WhatsAppTemplatePatchSchema,
  WhatsAppTemplateSchema,
} from "@ai-cmo/contracts";
import { PrismaService } from "../prisma.service";

export const DEFAULT_BRAND_ID = "luminesce-brand-001";

export class TemplateValidationError extends Error {
  constructor(
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

/** The bounded variable set a template may reference. */
export interface TemplateVariables {
  first_name?: string | null;
  cart_value?: number | null;
  currency?: string | null;
  product_names?: string[] | null;
  recovery_url?: string | null;
  discount_code?: string | null;
  discount_pct?: number | null;
}

export interface RenderResult {
  ok: boolean;
  body?: string;
  missing?: string[];
  error?: string;
}

/**
 * B4 — reusable message templates.
 *
 * Two validations, and both are load-bearing:
 *  - on write, every {{variable}} must be in ALLOWED_TEMPLATE_VARIABLES;
 *  - on render, every referenced variable must have a value.
 *
 * A template that fails either check is never sent — a customer must never
 * receive a message containing a literal "{{first_name}}".
 */
@Injectable()
export class WhatsAppTemplateService {
  private readonly logger = new Logger(WhatsAppTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(brandId = DEFAULT_BRAND_ID) {
    return this.prisma.whatsAppTemplate.findMany({
      where: { brandId },
      orderBy: { createdAt: "asc" },
    });
  }

  async get(id: string, brandId = DEFAULT_BRAND_ID) {
    return this.prisma.whatsAppTemplate.findFirst({ where: { id, brandId } });
  }

  async getByKey(key: string, brandId = DEFAULT_BRAND_ID) {
    return this.prisma.whatsAppTemplate.findUnique({
      where: { brandId_key: { brandId, key } },
    });
  }

  async create(input: unknown, brandId = DEFAULT_BRAND_ID) {
    const parsed = WhatsAppTemplateSchema.safeParse(input);
    if (!parsed.success) {
      throw new TemplateValidationError(
        "Invalid template",
        parsed.error.flatten(),
      );
    }
    const variables = this.validateVariables(parsed.data.body);

    return this.prisma.whatsAppTemplate.create({
      data: {
        brandId,
        key: parsed.data.key,
        type: parsed.data.type,
        name: parsed.data.name,
        body: parsed.data.body,
        variables: variables as any,
        active: parsed.data.active,
      },
    });
  }

  async update(id: string, input: unknown, brandId = DEFAULT_BRAND_ID) {
    const parsed = WhatsAppTemplatePatchSchema.safeParse(input);
    if (!parsed.success) {
      throw new TemplateValidationError(
        "Invalid template",
        parsed.error.flatten(),
      );
    }
    const existing = await this.get(id, brandId);
    if (!existing) throw new TemplateValidationError("Template not found");

    const body = parsed.data.body ?? existing.body;
    const variables = this.validateVariables(body);

    return this.prisma.whatsAppTemplate.update({
      where: { id },
      data: {
        ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
        ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.body !== undefined ? { body } : {}),
        ...(parsed.data.active !== undefined
          ? { active: parsed.data.active }
          : {}),
        variables: variables as any,
      },
    });
  }

  async remove(id: string, brandId = DEFAULT_BRAND_ID) {
    const existing = await this.get(id, brandId);
    if (!existing) throw new TemplateValidationError("Template not found");
    return this.prisma.whatsAppTemplate.delete({ where: { id } });
  }

  /**
   * Rejects any variable outside the allowed set, so an unknown placeholder is
   * caught at authoring time rather than becoming literal text in a send.
   */
  validateVariables(body: string): string[] {
    const used = extractTemplateVariables(body);
    const allowed = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);
    const unknown = used.filter((v) => !allowed.has(v));
    if (unknown.length > 0) {
      throw new TemplateValidationError(
        `Unknown template variable(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}. ` +
          `Allowed: ${ALLOWED_TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}`,
        { unknown, allowed: [...allowed] },
      );
    }
    return used;
  }

  /**
   * Substitutes values into a template.
   *
   * Returns `ok: false` with the missing names rather than emitting a partial
   * message — callers treat that as "do not send".
   */
  render(body: string, vars: TemplateVariables): RenderResult {
    let used: string[];
    try {
      used = this.validateVariables(body);
    } catch (err: any) {
      return { ok: false, error: err.message };
    }

    const resolved = this.resolve(vars);
    const missing = used.filter(
      (name) => resolved[name] === undefined || resolved[name] === null,
    );
    if (missing.length > 0) return { ok: false, missing };

    const rendered = body.replace(
      /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi,
      (_match, name: string) => String(resolved[name.toLowerCase()] ?? ""),
    );
    return { ok: true, body: rendered };
  }

  private resolve(vars: TemplateVariables): Record<string, string | null> {
    // Currency is always the store's own code (C3) — never a hardcoded symbol.
    const currency = vars.currency ?? null;
    const cartValue =
      vars.cart_value != null
        ? `${currency ? `${currency} ` : ""}${vars.cart_value.toFixed(2)}`
        : null;

    return {
      first_name: vars.first_name ?? null,
      cart_value: cartValue,
      currency,
      product_names:
        vars.product_names && vars.product_names.length > 0
          ? vars.product_names.slice(0, 5).join(", ")
          : null,
      recovery_url: vars.recovery_url ?? null,
      discount_code: vars.discount_code ?? null,
      discount_pct: vars.discount_pct != null ? `${vars.discount_pct}%` : null,
    };
  }

  /** Seeds the default library once, so the owner has a starting point. */
  async ensureDefaults(brandId = DEFAULT_BRAND_ID): Promise<void> {
    const count = await this.prisma.whatsAppTemplate.count({
      where: { brandId },
    });
    if (count > 0) return;

    const defaults: Array<{
      key: string;
      type: string;
      name: string;
      body: string;
    }> = [
      {
        key: "abandoned-cart-reminder",
        type: "ABANDONED_CART",
        name: "Abandoned cart — reminder",
        body:
          "Hi {{first_name}}, you left {{product_names}} in your cart.\n\n" +
          "Your cart ({{cart_value}}) is still available here:\n{{recovery_url}}",
      },
      {
        key: "abandoned-cart-offer",
        type: "ABANDONED_CART",
        name: "Abandoned cart — with offer",
        body:
          "Hi {{first_name}}, your cart ({{cart_value}}) is still waiting.\n\n" +
          "Use {{discount_code}} for {{discount_pct}} off:\n{{recovery_url}}",
      },
      {
        key: "replenishment",
        type: "REPLENISHMENT",
        name: "Replenishment reminder",
        body:
          "Hi {{first_name}}, running low on {{product_names}}? " +
          "Reorder here: {{recovery_url}}",
      },
      {
        key: "win-back",
        type: "WIN_BACK",
        name: "Win back",
        body:
          "Hi {{first_name}}, it's been a while. " +
          "Here's what's new: {{recovery_url}}",
      },
      {
        key: "vip",
        type: "VIP",
        name: "VIP early access",
        body:
          "Hi {{first_name}}, as one of our best customers you get early " +
          "access: {{recovery_url}}",
      },
      {
        key: "back-in-stock",
        type: "BACK_IN_STOCK",
        name: "Back in stock",
        body:
          "Good news {{first_name}} — {{product_names}} is back in stock: " +
          "{{recovery_url}}",
      },
      {
        key: "review-request",
        type: "REVIEW_REQUEST",
        name: "Review request",
        body:
          "Hi {{first_name}}, how are you finding {{product_names}}? " +
          "We'd love your feedback.",
      },
    ];

    for (const t of defaults) {
      await this.prisma.whatsAppTemplate.create({
        data: {
          brandId,
          key: t.key,
          type: t.type,
          name: t.name,
          body: t.body,
          variables: this.validateVariables(t.body) as any,
          active: true,
        },
      });
    }
    this.logger.log(`Seeded ${defaults.length} default WhatsApp templates`);
  }
}
