import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { BrowserActionService } from "./browser-action.service";
import { BrowserActionController } from "./browser-action.controller";

@Module({
  imports: [HttpModule],
  controllers: [BrowserActionController],
  providers: [BrowserActionService],
  exports: [BrowserActionService],
})
export class BrowserModule {}
