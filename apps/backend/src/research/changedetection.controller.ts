import {
  Body,
  Controller,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { ChangedetectionIngestService } from "./changedetection-ingest.service";

/**
 * Webhook receiver for changedetection.io.
 * Auth via CHANGEDETECTION_WEBHOOK_TOKEN query or header — never logs the token.
 */
@Controller("webhooks/changedetection")
export class ChangedetectionController {
  constructor(private readonly ingest: ChangedetectionIngestService) {}

  @Post()
  async receive(
    @Body() body: unknown,
    @Query("token") queryToken?: string,
    @Headers("x-webhook-token") headerToken?: string,
  ) {
    try {
      this.ingest.assertAuthorized(queryToken || headerToken);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException();
    }
    const result = await this.ingest.ingest(body);
    return {
      ok: true,
      ...result,
      note: "Change ingested as untrusted research evidence only — no auto-publish",
    };
  }
}
