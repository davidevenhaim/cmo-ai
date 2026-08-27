import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ShopifyGraphqlAdapter } from "./shopify-graphql.adapter";
import { ShopifyService } from "./shopify.service";
import { ShopifyController } from "./shopify.controller";
import { PrismaService } from "../prisma.service";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [HttpModule, SettingsModule],
  controllers: [ShopifyController],
  providers: [ShopifyGraphqlAdapter, ShopifyService, PrismaService],
  exports: [ShopifyService, ShopifyGraphqlAdapter],
})
export class ShopifyModule {}
