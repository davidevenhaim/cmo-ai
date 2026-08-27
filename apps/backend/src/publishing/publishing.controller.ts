import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PublishingService } from "./publishing.service";

@Controller("publishing")
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Post("requests")
  createRequest(
    @Body()
    body: {
      contentDraftId: string;
      provider: string;
      destination: string;
      scheduledAt?: string;
      providerMetadata?: Record<string, unknown>;
    },
  ) {
    return this.publishing.createRequest({
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    });
  }

  @Get("requests")
  listRequests(
    @Query("status") status?: string,
    @Query("provider") provider?: string,
    @Query("contentDraftId") contentDraftId?: string,
  ) {
    return this.publishing.listRequests({ status, provider, contentDraftId });
  }

  @Get("requests/:id")
  getRequest(@Param("id") id: string) {
    return this.publishing.getRequest(id);
  }

  @Patch("requests/:id/schedule")
  schedule(@Param("id") id: string, @Body() body: { scheduledAt: string }) {
    return this.publishing.schedule(id, new Date(body.scheduledAt));
  }

  @Patch("requests/:id/approve")
  approve(@Param("id") id: string) {
    return this.publishing.approve(id);
  }

  @Post("requests/:id/execute")
  execute(@Param("id") id: string) {
    return this.publishing.execute(id);
  }

  @Post("requests/:id/cancel")
  cancel(@Param("id") id: string) {
    return this.publishing.cancel(id);
  }

  @Post("requests/:id/dry-run")
  dryRun(@Param("id") id: string) {
    return this.publishing.dryRun(id);
  }

  @Get("requests/:id/safety-check")
  safetyCheck(@Param("id") id: string) {
    return this.publishing.safetyCheck(id);
  }

  @Post("requests/:id/reconcile")
  reconcile(@Param("id") id: string) {
    return this.publishing.reconcile(id);
  }
}
