import {
  TemplateValidationError,
  WhatsAppTemplateService,
} from "./whatsapp-template.service";

function makePrisma() {
  return {
    whatsAppTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "tpl-1" }),
      update: jest.fn().mockResolvedValue({ id: "tpl-1" }),
      delete: jest.fn().mockResolvedValue({ id: "tpl-1" }),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe("WhatsAppTemplateService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: WhatsAppTemplateService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WhatsAppTemplateService(prisma as any);
  });

  describe("variable validation", () => {
    it("accepts every allowed variable", () => {
      const vars = service.validateVariables(
        "Hi {{first_name}}, your cart {{cart_value}} in {{currency}} " +
          "with {{product_names}} — {{recovery_url}} " +
          "{{discount_code}} {{discount_pct}}",
      );
      expect(vars.sort()).toEqual(
        [
          "cart_value",
          "currency",
          "discount_code",
          "discount_pct",
          "first_name",
          "product_names",
          "recovery_url",
        ].sort(),
      );
    });

    it("rejects an unknown variable at authoring time", () => {
      expect(() =>
        service.validateVariables("Hi {{customer_email}}"),
      ).toThrow(TemplateValidationError);
    });

    it("names the offending variable in the error", () => {
      try {
        service.validateVariables("Hi {{nope}}");
        fail("should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("{{nope}}");
      }
    });

    it("tolerates whitespace inside the braces", () => {
      expect(service.validateVariables("Hi {{ first_name }}")).toEqual([
        "first_name",
      ]);
    });

    it("returns an empty list for a template with no variables", () => {
      expect(service.validateVariables("Plain text")).toEqual([]);
    });

    it("refuses to create a template with an unknown variable", async () => {
      await expect(
        service.create({
          key: "bad",
          type: "CUSTOM",
          name: "Bad",
          body: "Hi {{unknown_thing}}",
          active: true,
        }),
      ).rejects.toThrow(TemplateValidationError);
      expect(prisma.whatsAppTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe("rendering", () => {
    it("substitutes every supplied variable", () => {
      const result = service.render(
        "Hi {{first_name}}, your cart is {{cart_value}}: {{recovery_url}}",
        {
          first_name: "Dana",
          cart_value: 350,
          currency: "ILS",
          recovery_url: "https://shop.example/cart/abc",
        },
      );
      expect(result.ok).toBe(true);
      expect(result.body).toBe(
        "Hi Dana, your cart is ILS 350.00: https://shop.example/cart/abc",
      );
    });

    it("never sends a partially rendered message", () => {
      const result = service.render("Hi {{first_name}}, cart {{cart_value}}", {
        first_name: "Dana",
      });
      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(["cart_value"]);
      expect(result.body).toBeUndefined();
    });

    it("reports every missing variable, not just the first", () => {
      const result = service.render(
        "{{first_name}} {{cart_value}} {{recovery_url}}",
        {},
      );
      expect(result.missing!.sort()).toEqual([
        "cart_value",
        "first_name",
        "recovery_url",
      ]);
    });

    describe("currency (C3)", () => {
      it("uses the store currency code, never a hardcoded symbol", () => {
        const ils = service.render("{{cart_value}}", {
          cart_value: 350,
          currency: "ILS",
        });
        expect(ils.body).toBe("ILS 350.00");
        expect(ils.body).not.toContain("$");
        expect(ils.body).not.toContain("₪");
      });

      it("formats USD and EUR with their own codes", () => {
        expect(
          service.render("{{cart_value}}", { cart_value: 120, currency: "USD" })
            .body,
        ).toBe("USD 120.00");
        expect(
          service.render("{{cart_value}}", { cart_value: 95, currency: "EUR" })
            .body,
        ).toBe("EUR 95.00");
      });

      it("exposes the raw currency code on its own", () => {
        expect(service.render("{{currency}}", { currency: "ILS" }).body).toBe(
          "ILS",
        );
      });
    });

    it("joins product names and caps the list", () => {
      const result = service.render("{{product_names}}", {
        product_names: ["A", "B", "C", "D", "E", "F", "G"],
      });
      expect(result.body).toBe("A, B, C, D, E");
    });

    it("treats an empty product list as missing rather than blank", () => {
      const result = service.render("{{product_names}}", {
        product_names: [],
      });
      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(["product_names"]);
    });

    it("formats a discount percentage", () => {
      expect(
        service.render("{{discount_pct}}", { discount_pct: 10 }).body,
      ).toBe("10%");
    });

    it("renders zero cart value rather than treating it as missing", () => {
      const result = service.render("{{cart_value}}", {
        cart_value: 0,
        currency: "USD",
      });
      expect(result.ok).toBe(true);
      expect(result.body).toBe("USD 0.00");
    });

    it("fails closed on a template containing an unknown variable", () => {
      const result = service.render("Hi {{oops}}", { first_name: "Dana" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("{{oops}}");
    });
  });

  describe("defaults", () => {
    it("seeds the library only once", async () => {
      prisma.whatsAppTemplate.count.mockResolvedValue(3);
      await service.ensureDefaults();
      expect(prisma.whatsAppTemplate.create).not.toHaveBeenCalled();
    });

    it("seeds templates whose variables all validate", async () => {
      await service.ensureDefaults();
      expect(prisma.whatsAppTemplate.create).toHaveBeenCalled();
      for (const call of prisma.whatsAppTemplate.create.mock.calls) {
        expect(() =>
          service.validateVariables(call[0].data.body),
        ).not.toThrow();
      }
    });
  });
});
