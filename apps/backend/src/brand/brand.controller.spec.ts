import { Test, TestingModule } from "@nestjs/testing";
import { BrandController } from "./brand.controller";
import { BrandService } from "./brand.service";

const mockBrandService = {
  getFullProfile: jest.fn(),
  getFacts: jest.fn(),
  getProducts: jest.fn(),
  updateBrand: jest.fn(),
  addFact: jest.fn(),
};

describe("BrandController", () => {
  let controller: BrandController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BrandController],
      providers: [{ provide: BrandService, useValue: mockBrandService }],
    }).compile();
    controller = module.get<BrandController>(BrandController);
    jest.clearAllMocks();
  });

  it("getProfile delegates to service", async () => {
    const fakeBrand = { id: "luminesce-brand-001", name: "Luminesce" };
    mockBrandService.getFullProfile.mockResolvedValue(fakeBrand);
    const result = await controller.getProfile();
    expect(result).toEqual(fakeBrand);
    expect(mockBrandService.getFullProfile).toHaveBeenCalledTimes(1);
  });

  it("addFact delegates to service", async () => {
    const fakeFact = { id: "f1", category: "origin", content: "test" };
    mockBrandService.addFact.mockResolvedValue(fakeFact);
    const result = await controller.addFact({
      category: "origin",
      content: "test",
    });
    expect(result).toEqual(fakeFact);
  });
});
