import { Body, Controller, Post } from "@nestjs/common";
import { BrowserActionService } from "./browser-action.service";
import type { BrowserActionRequest } from "./browser-action.types";

@Controller("browser")
export class BrowserActionController {
  constructor(private readonly browser: BrowserActionService) {}

  @Post("actions")
  async execute(@Body() body: BrowserActionRequest) {
    return this.browser.execute(body);
  }
}
