import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

const BRAND_ID = "luminesce-brand-001";

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  async getFullProfile() {
    const brand = await this.prisma.brand.findUnique({
      where: { id: BRAND_ID },
      include: {
        facts: true,
        guidelines: true,
        sources: true,
        products: { where: { active: true } },
      },
    });
    if (!brand) throw new NotFoundException("Brand not found. Run db:seed.");
    return brand;
  }

  async getFacts() {
    return this.prisma.brandFact.findMany({ where: { brandId: BRAND_ID } });
  }

  async getProducts() {
    return this.prisma.product.findMany({
      where: { brandId: BRAND_ID, active: true },
    });
  }

  async updateBrand(dto: {
    name?: string;
    description?: string;
    voice?: string;
    audience?: string;
  }) {
    return this.prisma.brand.update({ where: { id: BRAND_ID }, data: dto });
  }

  async addFact(dto: {
    category: string;
    content: string;
    confidence?: number;
    sourceId?: string;
  }) {
    return this.prisma.brandFact.create({
      data: {
        brandId: BRAND_ID,
        category: dto.category,
        content: dto.content,
        confidence: dto.confidence ?? 1.0,
        sourceId: dto.sourceId ?? null,
      },
    });
  }
}
