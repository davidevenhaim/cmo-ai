import { Module, OnModuleInit } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { WordPressAdapter } from "./wordpress.adapter";
import { WordPressController } from "./wordpress.controller";
import { PublishingModule } from "../publishing/publishing.module";
import { PublishingService } from "../publishing/publishing.service";

@Module({
  imports: [HttpModule, ConfigModule, PublishingModule],
  controllers: [WordPressController],
  providers: [WordPressAdapter],
  exports: [WordPressAdapter],
})
export class WordPressModule implements OnModuleInit {
  constructor(
    private readonly wpAdapter: WordPressAdapter,
    private readonly publishingService: PublishingService,
  ) {}

  onModuleInit() {
    this.publishingService.registerPublisher(this.wpAdapter);
  }
}
