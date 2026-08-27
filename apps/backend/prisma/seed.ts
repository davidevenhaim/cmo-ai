import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Idempotent: upsert brand by name
  const brand = await prisma.brand.upsert({
    where: { id: "luminesce-brand-001" },
    update: {},
    create: {
      id: "luminesce-brand-001",
      name: "Luminesce",
      description:
        "Clean, science-backed skincare for discerning women who want visible results without compromise.",
      voice: JSON.stringify({
        tone: "warm, confident, scientific yet accessible",
        personality: ["knowledgeable", "trustworthy", "empowering", "honest"],
        avoidWords: [
          "miracle",
          "magic",
          "instant",
          "toxic-free",
          "chemical-free",
        ],
      }),
      audience: JSON.stringify({
        primaryAge: "28-45",
        gender: "women",
        values: ["ingredient transparency", "sustainability", "efficacy"],
        painPoints: [
          "overwhelmed by marketing claims",
          "sensitive skin flare-ups",
          "wanting evidence-based routines",
        ],
        lifestyle: "health-conscious professionals",
      }),
    },
  });

  const source = await prisma.brandSource.upsert({
    where: { id: "luminesce-source-001" },
    update: {},
    create: {
      id: "luminesce-source-001",
      brandId: brand.id,
      type: "manual",
      label: "Brand Bible — Luminesce v1.0",
      url: null,
      fetchedAt: new Date("2024-01-15"),
    },
  });

  const facts = [
    {
      id: "fact-origin-001",
      category: "origin",
      content:
        "Luminesce was founded in 2019 by a biochemist and a dermatologist who were frustrated by the gap between clinical skincare research and consumer products available on the market.",
      confidence: 1.0,
    },
    {
      id: "fact-mission-001",
      category: "mission",
      content:
        "Our mission is to make evidence-based skincare accessible: every product is formulated around peer-reviewed research, with clinical testing on diverse skin types.",
      confidence: 1.0,
    },
    {
      id: "fact-differentiator-001",
      category: "differentiator",
      content:
        "Unlike most clean beauty brands, Luminesce does not avoid all synthetic ingredients. We evaluate every ingredient on safety data, not origin. This lets us combine the best of natural and synthetic chemistry.",
      confidence: 1.0,
    },
    {
      id: "fact-audience-001",
      category: "audience",
      content:
        "Core customer is a woman aged 28–45, college-educated, health-conscious, fatigued by greenwashing, and willing to pay a premium for products that explain their ingredient rationale.",
      confidence: 0.95,
    },
    {
      id: "fact-sustainability-001",
      category: "sustainability",
      content:
        "All outer packaging is made from 100% post-consumer recycled materials. Refill pouches are available for all hero SKUs, reducing plastic by 70% versus single-use bottles.",
      confidence: 1.0,
    },
    {
      id: "fact-ingredient-philosophy-001",
      category: "ingredient-philosophy",
      content:
        "Formulations are built around three pillars: barrier support (ceramides, fatty acids), targeted actives (retinoids, peptides, vitamins), and skin-identical humectants (hyaluronic acid, glycerin). No fragrance in any formula.",
      confidence: 1.0,
    },
  ];

  for (const fact of facts) {
    await prisma.brandFact.upsert({
      where: { id: fact.id },
      update: {},
      create: {
        ...fact,
        brandId: brand.id,
        sourceId: source.id,
      },
    });
  }

  const guidelines = [
    {
      id: "guideline-tone-001",
      category: "tone",
      rule: "Write as a knowledgeable friend who happens to be a scientist. Warm, direct, never condescending. Explain the 'why' behind every ingredient recommendation.",
      example:
        "Instead of 'Our serum hydrates skin', write 'Hyaluronic acid draws moisture from the environment into your skin barrier — that's why you'll notice plumper skin within hours.'",
    },
    {
      id: "guideline-visual-001",
      category: "visual",
      rule: "Use a minimalist palette: off-white, pale sage, warm sand. Photography is clean with natural light. No heavily filtered or retouched skin imagery.",
      example: null,
    },
    {
      id: "guideline-messaging-001",
      category: "messaging",
      rule: "Lead with evidence. Every marketing claim must be backed by either a cited study or our own clinical trial data. Avoid superlatives without proof.",
      example:
        "Instead of 'The best moisturizer you've ever tried', write 'In our 8-week trial, 89% of participants reported improved skin texture.'",
    },
    {
      id: "guideline-avoid-001",
      category: "avoid",
      rule: "Never use greenwashing language: 'toxic-free', 'chemical-free', 'all-natural is better'. Never promise results without qualification. Never shame skin conditions.",
      example: null,
    },
  ];

  for (const guideline of guidelines) {
    await prisma.brandGuideline.upsert({
      where: { id: guideline.id },
      update: {},
      create: {
        ...guideline,
        brandId: brand.id,
      },
    });
  }

  const products = [
    {
      id: "product-barrier-serum-001",
      name: "Barrier Repair Serum",
      description:
        "A lightweight, fragrance-free serum that reinforces the skin barrier with ceramide NP, fatty acids, and niacinamide. Formulated for compromised, reactive, or post-procedure skin.",
      category: "serum",
      price: 68.0,
      tags: [
        "barrier",
        "ceramides",
        "niacinamide",
        "sensitive",
        "fragrance-free",
      ],
    },
    {
      id: "product-vitamin-c-moisturizer-001",
      name: "Vitamin C Brightening Moisturizer",
      description:
        "A stable 10% ascorbic acid moisturizer with vitamin E and ferulic acid for synergistic antioxidant protection. Targets hyperpigmentation and dullness over 8 weeks.",
      category: "moisturizer",
      price: 72.0,
      tags: ["vitamin-c", "brightening", "antioxidant", "hyperpigmentation"],
    },
    {
      id: "product-enzyme-exfoliant-001",
      name: "Gentle Enzyme Exfoliant",
      description:
        "A pH-balanced exfoliant combining papain enzyme with 5% mandelic acid for gentle resurfacing. Safe for sensitive and rosacea-prone skin.",
      category: "exfoliant",
      price: 58.0,
      tags: [
        "exfoliant",
        "enzyme",
        "mandelic-acid",
        "sensitive",
        "resurfacing",
      ],
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: {
        ...product,
        brandId: brand.id,
        active: true,
      },
    });
  }

  console.log("Seed complete: Luminesce brand data loaded.");

  // Bootstrap runtime settings once — never overwrite persisted owner policy.
  const commerceBootstrap = {
    lowStockThreshold: numEnv("SHOPIFY_LOW_STOCK_THRESHOLD", 5),
    defaultMetricsPeriodDays: numEnv("SHOPIFY_DEFAULT_PERIOD_DAYS", 30),
  };
  const revenueBootstrap = {
    maxDiscountPct: numEnv("REVENUE_MAX_DISCOUNT_PCT", 20),
    minContributionMarginPct: numEnv("REVENUE_MIN_MARGIN_PCT", 15),
    minOrderValue: numEnv("REVENUE_MIN_ORDER_VALUE", 30),
    maxDiscountsPerJourney: Math.floor(
      numEnv("REVENUE_MAX_DISCOUNTS_PER_JOURNEY", 2),
    ),
    minHoursBeforeDiscount: numEnv("REVENUE_MIN_HOURS_BEFORE_DISCOUNT", 6),
    recoveryLadderHours: listEnv(
      "REVENUE_RECOVERY_LADDER_HOURS",
      [1, 6, 24, 48],
    ),
    winBackDays: Math.floor(numEnv("REVENUE_WIN_BACK_DAYS", 90)),
    vipLtvThreshold: numEnv("REVENUE_VIP_LTV_THRESHOLD", 500),
    freeShippingNearFactor: numEnv("REVENUE_FREE_SHIPPING_NEAR_FACTOR", 0.8),
  };

  const existingCommerce = await prisma.commerceSettings.findUnique({
    where: { brandId: brand.id },
  });
  if (!existingCommerce) {
    await prisma.commerceSettings.create({
      data: { brandId: brand.id, ...commerceBootstrap },
    });
    await prisma.settingsAuditLog.create({
      data: {
        brandId: brand.id,
        scope: "COMMERCE",
        field: "*",
        previousValue: undefined,
        newValue: commerceBootstrap,
        source: "BOOTSTRAP",
      },
    });
  }

  const existingRevenue = await prisma.revenuePolicy.findUnique({
    where: { brandId: brand.id },
  });
  if (!existingRevenue) {
    await prisma.revenuePolicy.create({
      data: { brandId: brand.id, ...revenueBootstrap },
    });
    await prisma.settingsAuditLog.create({
      data: {
        brandId: brand.id,
        scope: "REVENUE",
        field: "*",
        previousValue: undefined,
        newValue: revenueBootstrap,
        source: "BOOTSTRAP",
      },
    });
  }

  console.log("Seed complete: runtime CommerceSettings + RevenuePolicy ready.");
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function listEnv(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : fallback;
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
