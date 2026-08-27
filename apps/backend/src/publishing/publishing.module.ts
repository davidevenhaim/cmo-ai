import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { PublishingController } from "./publishing.controller";
import { PublishingService } from "./publishing.service";
import { ContentCalendarService } from "./content-calendar.service";
import { ContentCalendarController } from "./content-calendar.controller";

@Module({
  controllers: [PublishingController, ContentCalendarController],
  providers: [PrismaService, PublishingService, ContentCalendarService],
  exports: [PublishingService, ContentCalendarService],
})
export class PublishingModule {}
