import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from "@nestjs/common";
import { OperatorCommandSchema } from "@ai-cmo/contracts";
import { OperatorBriefService } from "./operator-brief.service";
import { OperatorStatusService } from "./operator-status.service";
import { OperatorAnalyticsService } from "./operator-analytics.service";
import { OperatorCommandService } from "./operator-command.service";

@Controller("operator")
export class OperatorController {
  constructor(
    private readonly brief: OperatorBriefService,
    private readonly status: OperatorStatusService,
    private readonly analytics: OperatorAnalyticsService,
    private readonly command: OperatorCommandService,
  ) {}

  @Get("today")
  getToday() {
    return this.brief.buildToday();
  }

  @Get("status")
  getStatus() {
    return this.status.getStatus();
  }

  @Get("analytics")
  getAnalytics() {
    return this.analytics.getAnalytics();
  }

  // Pre-send eligibility count/value — authoritative gates still run at send time.
  @Get("recovery/eligible")
  getEligibleRecoveries() {
    return this.brief.countEligibleRecoveries();
  }

  // Zod-validated (global ValidationPipe only covers class DTOs).
  @Post("command")
  executeCommand(@Body() body: unknown) {
    const parsed = OperatorCommandSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.format());
    }
    return this.command.execute(parsed.data);
  }
}
