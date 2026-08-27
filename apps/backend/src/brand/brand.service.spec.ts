import { Test, TestingModule } from "@nestjs/testing";
import { BrandService } from "./brand.service";
import { PrismaService } from "../prisma.service";
import { NotFoundException } from "@nestjs/common";

const mockPrisma = {
  brand: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  brandFact: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
};

describe("BrandService", () => {
  let service: BrandService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<BrandService>(BrandService);
    jest.clearAllMocks();
  });

  it("getFullProfile throws NotFoundException when brand missing", async () => {
    mockPrisma.brand.findUnique.mockResolvedValue(null);
    await expect(service.getFullProfile()).rejects.toThrow(NotFoundException);
  });

  it("getFullProfile returns brand when found", async () => {
    const fakeBrand = {
      id: "luminesce-brand-001",
      name: "Luminesce",
      facts: [],
      guidelines: [],
      sources: [],
      products: [],
    };
    mockPrisma.brand.findUnique.mockResolvedValue(fakeBrand);
    const result = await service.getFullProfile();
    expect(result.name).toBe("Luminesce");
  });

  it("addFact creates fact with defaults", async () => {
    const fakeFact = {
      id: "f1",
      brandId: "luminesce-brand-001",
      category: "origin",
      content: "test",
      confidence: 1.0,
      sourceId: null,
    };
    mockPrisma.brandFact.create.mockResolvedValue(fakeFact);
    const result = await service.addFact({
      category: "origin",
      content: "test",
    });
    expect(mockPrisma.brandFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ confidence: 1.0, sourceId: null }),
    });
    expect(result.category).toBe("origin");
  });
});
