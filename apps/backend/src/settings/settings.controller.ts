import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Query,
} from "@nestjs/common";
import {
  RuntimeSettingsService,
  SettingsValidationError,
} from "./runtime-settings.service";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: RuntimeSettingsService) {}

  @Get()
  async get() {
    return this.settings.getAll();
  }

  @Get("commerce")
  async getCommerce() {
    return this.settings.getCommerce();
  }

  @Patch("commerce")
  async patchCommerce(@Body() body: unknown) {
    try {
      return await this.settings.patchCommerce(body, {
        source: "ADMIN_UI",
        actor: "admin",
      });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        throw new BadRequestException({
          message: "Invalid commerce settings",
          details: err.details,
        });
      }
      throw err;
    }
  }

  @Get("revenue")
  async getRevenue() {
    return this.settings.getRevenue();
  }

  @Patch("revenue")
  async patchRevenue(@Body() body: unknown) {
    try {
      return await this.settings.patchRevenue(body, {
        source: "ADMIN_UI",
        actor: "admin",
      });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        throw new BadRequestException({
          message: "Invalid revenue policy",
          details: err.details,
        });
      }
      throw err;
    }
  }

  @Get("audit")
  async audit(@Query("take") take?: string) {
    const n = take ? parseInt(take, 10) : 50;
    return this.settings.listAudit(
      undefined,
      Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 50,
    );
  }
}
