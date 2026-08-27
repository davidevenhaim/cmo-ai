import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { RuntimeSettingsService } from "./runtime-settings.service";
import { SettingsController } from "./settings.controller";

@Module({
  controllers: [SettingsController],
  providers: [PrismaService, RuntimeSettingsService],
  exports: [RuntimeSettingsService],
})
export class SettingsModule {}
