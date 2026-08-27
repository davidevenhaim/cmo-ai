import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CmoService } from "./cmo.service";

@Controller()
export class CmoController {
  constructor(
    private readonly cmoService: CmoService,
    private readonly config: ConfigService,
  ) {}

  @Get("cmo/runs")
  listRuns() {
    return this.cmoService.listRuns();
  }

  @Get("cmo/runs/:id")
  getRun(@Param("id") id: string) {
    return this.cmoService.getRun(id);
  }

  @Post("dev/cmo/run")
  triggerDevRun() {
    if (this.config.get<string>("NODE_ENV") !== "development") {
      throw new ForbiddenException(
        "dev/cmo/run is only available in development",
      );
    }
    return this.cmoService.triggerDevRun();
  }
}
