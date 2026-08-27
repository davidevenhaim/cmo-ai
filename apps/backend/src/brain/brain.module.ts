import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { BrainAdapter } from "./brain.adapter";

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [BrainAdapter],
  exports: [BrainAdapter],
})
export class BrainModule {}
