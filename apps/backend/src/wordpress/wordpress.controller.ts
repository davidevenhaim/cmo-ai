import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { WordPressAdapter } from "./wordpress.adapter";
import { PublishingService } from "../publishing/publishing.service";

@Controller("wordpress")
export class WordPressController {
  constructor(
    private readonly wp: WordPressAdapter,
    private readonly publishing: PublishingService,
  ) {}

  @Get("health")
  health() {
    return this.wp.health();
  }

  @Get("blog-context")
  blogContext() {
    return this.wp.buildBlogContext();
  }

  @Get("posts")
  recentPosts() {
    return this.wp.getRecentPosts(20);
  }

  @Get("categories")
  categories() {
    return this.wp.getCategories();
  }

  // Create a remote WordPress draft from an approved ContentDraft.
  // Requires an existing approved PublishRequest — does not auto-create one.
  @Post("requests/:requestId/create-draft")
  createRemoteDraft(@Param("requestId") requestId: string) {
    return this.publishing.execute(requestId);
  }

  // Publish a WordPress post — must have an existing remote draft (remoteId in providerMetadata).
  @Post("requests/:requestId/publish")
  publish(@Param("requestId") requestId: string) {
    return this.publishing.execute(requestId);
  }

  @Post("requests/:requestId/retry")
  retry(@Param("requestId") requestId: string) {
    return this.publishing.execute(requestId);
  }

  @Get("requests")
  listRequests() {
    return this.publishing.listRequests({ provider: "wordpress" });
  }
}
