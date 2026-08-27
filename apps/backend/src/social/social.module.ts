import { Module, OnModuleInit } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { PostizPublisher } from "./postiz.publisher";
import { SocialController } from "./social.controller";
import { PublishingModule } from "../publishing/publishing.module";
import { PublishingService } from "../publishing/publishing.service";

@Module({
  imports: [HttpModule, ConfigModule, PublishingModule],
  controllers: [SocialController],
  providers: [PostizPublisher],
  exports: [PostizPublisher],
})
export class SocialModule implements OnModuleInit {
  constructor(
    private readonly postiz: PostizPublisher,
    private readonly publishing: PublishingService,
  ) {}

  onModuleInit() {
    this.publishing.registerPublisher(this.postiz);
  }
}
