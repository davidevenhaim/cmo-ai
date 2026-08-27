import { Controller, Get, Post, Param } from "@nestjs/common";
import { PostizPublisher, SUPPORTED_CHANNELS } from "./postiz.publisher";
import { PublishingService } from "../publishing/publishing.service";

@Controller("social")
export class SocialController {
  constructor(
    private readonly postiz: PostizPublisher,
    private readonly publishing: PublishingService,
  ) {}

  @Get("health")
  health() {
    return this.postiz.health();
  }

  @Get("channels")
  channels() {
    return { supported: SUPPORTED_CHANNELS };
  }

  @Post("requests/:requestId/execute")
  execute(@Param("requestId") requestId: string) {
    return this.publishing.execute(requestId);
  }

  @Get("requests")
  listRequests() {
    return this.publishing.listRequests({ provider: "postiz" });
  }
}
