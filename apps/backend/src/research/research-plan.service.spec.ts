import { Test, TestingModule } from "@nestjs/testing";
import { ResearchPlanService } from "./research-plan.service";

const brandContext = {
  brand: {
    name: "Luminesce",
    description: "Clean skincare",
    audience: "Women 28-45 interested in clean beauty",
  },
  products: [
    { name: "Barrier Repair Serum", category: "Serum" },
    { name: "Vitamin C Moisturizer", category: "Moisturizer" },
  ],
  facts: [
    {
      category: "differentiator",
      content: "Barrier repair formulas using ceramides",
    },
    {
      category: "mission",
      content: "Clean ingredients, science-backed skincare",
    },
  ],
  competitorUrls: ["https://competitor.com"],
};

describe("ResearchPlanService", () => {
  let service: ResearchPlanService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResearchPlanService],
    }).compile();
    service = module.get<ResearchPlanService>(ResearchPlanService);
  });

  it("generates queries from brand context", () => {
    const plan = service.buildPlanFromBrandContext(brandContext);
    expect(plan.queries.length).toBeGreaterThan(3);
  });

  it("includes trend and customer question intents", () => {
    const plan = service.buildPlanFromBrandContext(brandContext);
    const intents = plan.queries.map((q) => q.intent);
    expect(intents).toContain("TREND");
    expect(intents).toContain("CUSTOMER_QUESTION");
  });

  it("includes product-specific queries", () => {
    const plan = service.buildPlanFromBrandContext(brandContext);
    const queries = plan.queries.map((q) => q.query.toLowerCase());
    const hasProduct = queries.some(
      (q) => q.includes("barrier repair") || q.includes("vitamin c"),
    );
    expect(hasProduct).toBe(true);
  });

  it("includes competitor URLs in source list", () => {
    const plan = service.buildPlanFromBrandContext(brandContext);
    expect(plan.sourceUrls).toContain("https://competitor.com");
  });

  it("handles brand with no products gracefully", () => {
    const plan = service.buildPlanFromBrandContext({
      ...brandContext,
      products: [],
    });
    expect(plan.queries.length).toBeGreaterThan(0);
  });

  it("all queries have non-empty query strings", () => {
    const plan = service.buildPlanFromBrandContext(brandContext);
    for (const q of plan.queries) {
      expect(q.query.trim()).not.toBe("");
    }
  });
});
