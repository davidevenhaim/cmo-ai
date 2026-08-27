import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { BrandService } from "./brand.service";
import { UpdateBrandDto, AddFactDto } from "../common/dto/brand.dto";

@Controller("brand")
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Get()
  getProfile() {
    return this.brandService.getFullProfile();
  }

  @Get("facts")
  getFacts() {
    return this.brandService.getFacts();
  }

  @Get("products")
  getProducts() {
    return this.brandService.getProducts();
  }

  @Patch()
  updateBrand(@Body() dto: UpdateBrandDto) {
    return this.brandService.updateBrand(dto);
  }

  @Post("facts")
  addFact(@Body() dto: AddFactDto) {
    return this.brandService.addFact(dto);
  }
}
